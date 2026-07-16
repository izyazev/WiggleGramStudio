use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::{imageops, DynamicImage, GenericImageView, ImageReader, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, Cursor, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const MAX_GIF_SIZE_MB: f64 = 64.0;
const GITHUB_REPOSITORY_URL: &str = "https://github.com/izyazev/WiggleGramStudio";
const GITHUB_RELEASES_URL: &str = "https://github.com/izyazev/WiggleGramStudio/releases/latest";

#[derive(Default)]
struct ExportState {
    cancelled: AtomicBool,
    last_output: Mutex<Option<PathBuf>>,
}

#[derive(Clone, Copy)]
enum UiLanguage {
    Ru,
    En,
}

struct LanguageState {
    code: Mutex<String>,
}

impl Default for LanguageState {
    fn default() -> Self {
        Self {
            code: Mutex::new("en".into()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedImage {
    path: String,
    name: String,
    width: u32,
    height: u32,
    preview_url: String,
    preview_width: u32,
    preview_height: u32,
    file_size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CropRect {
    x: i64,
    y: i64,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportFrame {
    path: String,
    width: u32,
    height: u32,
    file_size_bytes: u64,
    point: Point,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFrame {
    path: String,
    width: u32,
    height: u32,
    point: Point,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    frames: Vec<ExportFrame>,
    crop: CropRect,
    speed_ms: u64,
    mode: String,
    interpolation_mode: String,
    duration_seconds: f64,
    scale: f64,
    format: String,
    image_format: String,
    output_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequest {
    frames: Vec<PreviewFrame>,
    crop: CropRect,
    speed_ms: u64,
    mode: String,
    max_size: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    percent: f64,
    message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InterpolationMode {
    Off,
    Blend,
    Smooth,
}

fn resolve_language(code: &str) -> UiLanguage {
    if code.eq_ignore_ascii_case("ru") {
        UiLanguage::Ru
    } else {
        UiLanguage::En
    }
}

fn current_language(state: &State<'_, LanguageState>) -> UiLanguage {
    state
        .code
        .lock()
        .map(|code| resolve_language(&code))
        .unwrap_or(UiLanguage::En)
}

fn tr(language: UiLanguage, ru: &'static str, en: &'static str) -> &'static str {
    match language {
        UiLanguage::Ru => ru,
        UiLanguage::En => en,
    }
}

fn resolve_interpolation_mode(mode: &str) -> Option<InterpolationMode> {
    match mode {
        "off" => Some(InterpolationMode::Off),
        "blend" => Some(InterpolationMode::Blend),
        "smooth" => Some(InterpolationMode::Smooth),
        _ => None,
    }
}

#[tauri::command]
fn set_language(state: State<'_, LanguageState>, language: String) -> Result<(), String> {
    let normalized = if language.eq_ignore_ascii_case("ru") {
        "ru"
    } else {
        "en"
    };
    *state
        .code
        .lock()
        .map_err(|_| "Failed to store interface language".to_string())? = normalized.into();
    Ok(())
}

fn read_orientation(path: &Path) -> u32 {
    File::open(path)
        .ok()
        .and_then(|file| {
            exif::Reader::new()
                .read_from_container(&mut BufReader::new(file))
                .ok()
        })
        .and_then(|exif| {
            exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .cloned()
        })
        .and_then(|field| field.value.get_uint(0))
        .unwrap_or(1)
}

fn orient(image: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        7 => image.rotate270().fliph(),
        8 => image.rotate270(),
        _ => image,
    }
}

fn decode_oriented(path: &Path, language: UiLanguage) -> Result<DynamicImage, String> {
    let orientation = read_orientation(path);
    let reader = ImageReader::open(path)
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(language, "Не удалось открыть", "Failed to open"),
                path.display()
            )
        })?
        .with_guessed_format()
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(
                    language,
                    "Не удалось определить формат",
                    "Failed to detect the format of"
                ),
                path.display()
            )
        })?;
    let image = reader.decode().map_err(|error| match language {
        UiLanguage::Ru => format!(
            "Файл \"{}\" повреждён или имеет неподдерживаемый формат: {error}",
            path.display()
        ),
        UiLanguage::En => format!(
            "The file \"{}\" is corrupted or uses an unsupported format: {error}",
            path.display()
        ),
    })?;
    Ok(orient(image, orientation))
}

fn load_one(path: PathBuf, language: UiLanguage) -> Result<LoadedImage, String> {
    let file_size_bytes = fs::metadata(&path)
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(
                    language,
                    "Не удалось прочитать размер",
                    "Failed to read the size of"
                ),
                path.display()
            )
        })?
        .len();
    let image = decode_oriented(&path, language)?;
    let (width, height) = image.dimensions();
    if width < 2 || height < 2 {
        return Err(match language {
            UiLanguage::Ru => format!("Изображение \"{}\" слишком мало", path.display()),
            UiLanguage::En => format!("The image \"{}\" is too small", path.display()),
        });
    }
    let preview = image.resize(1600, 1600, imageops::FilterType::Lanczos3);
    let (preview_width, preview_height) = preview.dimensions();
    let mut bytes = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 88);
    encoder.encode_image(&preview).map_err(|error| {
        format!(
            "{} \"{}\": {error}",
            tr(
                language,
                "Не удалось создать превью",
                "Failed to create a preview for"
            ),
            path.display()
        )
    })?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("photo")
        .to_owned();
    Ok(LoadedImage {
        path: path.to_string_lossy().into_owned(),
        name,
        width,
        height,
        preview_url: format!(
            "data:image/jpeg;base64,{}",
            BASE64.encode(bytes.into_inner())
        ),
        preview_width,
        preview_height,
        file_size_bytes,
    })
}

#[tauri::command]
async fn load_images(
    language_state: State<'_, LanguageState>,
    paths: Vec<String>,
) -> Result<Vec<LoadedImage>, String> {
    let language = current_language(&language_state);
    if paths.is_empty() || paths.len() > 4 {
        return Err(tr(
            language,
            "Выберите от одной до четырёх фотографий",
            "Choose between one and four photos",
        )
        .into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| load_one(PathBuf::from(path), language))
            .collect()
    })
    .await
    .map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Ошибка обработки изображений",
                "Image processing error"
            )
        )
    })?
}

fn validate_request(request: &ExportRequest, language: UiLanguage) -> Result<(), String> {
    if !(2..=4).contains(&request.frames.len()) {
        return Err(tr(
            language,
            "Для экспорта нужны 2–4 фотографии",
            "Export requires 2–4 photos",
        )
        .into());
    }
    if !(50..=1000).contains(&request.speed_ms) {
        return Err(tr(
            language,
            "Скорость должна быть от 50 до 1000 мс",
            "Frame speed must be between 50 and 1000 ms",
        )
        .into());
    }
    if !(0.2..=120.0).contains(&request.duration_seconds) {
        return Err(tr(
            language,
            "Длительность должна быть от 0,2 до 120 секунд",
            "Duration must be between 0.2 and 120 seconds",
        )
        .into());
    }
    if request.crop.width < 2 || request.crop.height < 2 || !(0.1..=1.0).contains(&request.scale) {
        return Err(tr(
            language,
            "Некорректные параметры кадрирования или масштаба",
            "Invalid crop or scale settings",
        )
        .into());
    }
    if request.mode != "loop" && request.mode != "ping-pong" {
        return Err(tr(
            language,
            "Неизвестный режим воспроизведения",
            "Unknown playback mode",
        )
        .into());
    }
    if resolve_interpolation_mode(&request.interpolation_mode).is_none() {
        return Err(tr(
            language,
            "Неизвестный режим промежуточных кадров",
            "Unknown interpolation mode",
        )
        .into());
    }
    if request.format != "mp4" && request.format != "gif" && request.format != "pic" {
        return Err(tr(
            language,
            "Неизвестный формат экспорта",
            "Unknown export format",
        )
        .into());
    }
    if request.format == "pic"
        && request.image_format != "png"
        && request.image_format != "jpg"
        && request.image_format != "tiff"
    {
        return Err(tr(
            language,
            "Неизвестный формат изображений",
            "Unknown image format",
        )
        .into());
    }

    let base = &request.frames[0].point;
    let mut left = f64::NEG_INFINITY;
    let mut top = f64::NEG_INFINITY;
    let mut right = f64::INFINITY;
    let mut bottom = f64::INFINITY;
    for frame in &request.frames {
        let dx = base.x - frame.point.x;
        let dy = base.y - frame.point.y;
        left = left.max(dx);
        top = top.max(dy);
        right = right.min(dx + frame.width as f64);
        bottom = bottom.min(dy + frame.height as f64);
    }
    let crop_right = request.crop.x as f64 + request.crop.width as f64;
    let crop_bottom = request.crop.y as f64 + request.crop.height as f64;
    if request.crop.x as f64 + 0.001 < left.ceil()
        || request.crop.y as f64 + 0.001 < top.ceil()
        || crop_right > right.floor() + 0.001
        || crop_bottom > bottom.floor() + 0.001
    {
        return Err(tr(
            language,
            "Область кадрирования выходит за общую область кадров",
            "The crop area is outside the common frame area",
        )
        .into());
    }
    Ok(())
}

fn validate_preview_request(request: &PreviewRequest, language: UiLanguage) -> Result<(), String> {
    if !(2..=4).contains(&request.frames.len()) {
        return Err(tr(
            language,
            "Для превью нужны 2–4 фотографии",
            "Preview requires 2–4 photos",
        )
        .into());
    }
    if !(50..=1000).contains(&request.speed_ms) {
        return Err(tr(
            language,
            "Скорость должна быть от 50 до 1000 мс",
            "Frame speed must be between 50 and 1000 ms",
        )
        .into());
    }
    if request.mode != "loop" && request.mode != "ping-pong" {
        return Err(tr(
            language,
            "Неизвестный режим воспроизведения",
            "Unknown playback mode",
        )
        .into());
    }
    let max_size = request.max_size.unwrap_or(960);
    if !(128..=2048).contains(&max_size) {
        return Err(tr(
            language,
            "Некорректный размер превью",
            "Invalid preview size",
        )
        .into());
    }
    if request.crop.width < 2 || request.crop.height < 2 {
        return Err(tr(
            language,
            "Некорректные параметры кадрирования",
            "Invalid crop settings",
        )
        .into());
    }

    let base = &request.frames[0].point;
    let mut left = f64::NEG_INFINITY;
    let mut top = f64::NEG_INFINITY;
    let mut right = f64::INFINITY;
    let mut bottom = f64::INFINITY;
    for frame in &request.frames {
        let dx = base.x - frame.point.x;
        let dy = base.y - frame.point.y;
        left = left.max(dx);
        top = top.max(dy);
        right = right.min(dx + frame.width as f64);
        bottom = bottom.min(dy + frame.height as f64);
    }
    let crop_right = request.crop.x as f64 + request.crop.width as f64;
    let crop_bottom = request.crop.y as f64 + request.crop.height as f64;
    if request.crop.x as f64 + 0.001 < left.ceil()
        || request.crop.y as f64 + 0.001 < top.ceil()
        || crop_right > right.floor() + 0.001
        || crop_bottom > bottom.floor() + 0.001
    {
        return Err(tr(
            language,
            "Область кадрирования выходит за общую область кадров",
            "The crop area is outside the common frame area",
        )
        .into());
    }
    Ok(())
}

fn sequence_len(count: usize, mode: &str) -> usize {
    if mode == "ping-pong" && count > 2 {
        count * 2 - 2
    } else {
        count
    }
}

fn sequence_indices(count: usize, mode: &str) -> Vec<usize> {
    let mut result: Vec<usize> = (0..count).collect();
    if mode == "ping-pong" && count > 2 {
        result.extend((1..count - 1).rev());
    }
    result
}

#[derive(Clone, Copy, Debug)]
struct SequenceStep {
    frame_index: usize,
    next_frame_index: usize,
    blend: bool,
}

fn sequence_steps(
    count: usize,
    mode: &str,
    interpolation_mode: InterpolationMode,
) -> Vec<SequenceStep> {
    let order = sequence_indices(count, mode);
    if order.is_empty() {
        return Vec::new();
    }
    if interpolation_mode == InterpolationMode::Off || order.len() < 2 {
        return order
            .iter()
            .enumerate()
            .map(|(index, frame_index)| SequenceStep {
                frame_index: *frame_index,
                next_frame_index: order[(index + 1) % order.len()],
                blend: false,
            })
            .collect();
    }
    order
        .iter()
        .enumerate()
        .flat_map(|(index, frame_index)| {
            let next_frame_index = order[(index + 1) % order.len()];
            [
                SequenceStep {
                    frame_index: *frame_index,
                    next_frame_index,
                    blend: false,
                },
                SequenceStep {
                    frame_index: *frame_index,
                    next_frame_index,
                    blend: true,
                },
            ]
        })
        .collect()
}

fn source_image_bits_per_pixel(frames: &[ExportFrame]) -> f64 {
    let pixels: u64 = frames
        .iter()
        .map(|frame| frame.width as u64 * frame.height as u64)
        .sum();
    let bits: u64 = frames.iter().map(|frame| frame.file_size_bytes * 8).sum();
    if pixels > 0 && bits > 0 {
        bits as f64 / pixels as f64
    } else {
        4.4
    }
}

fn gif_loop_duration_seconds(frame_count: usize, mode: &str, speed_ms: u64) -> f64 {
    sequence_len(frame_count, mode) as f64 * speed_ms as f64 / 1000.0
}

fn estimate_gif_size_mb(
    width: u32,
    height: u32,
    frame_count: usize,
    mode: &str,
    source_bits_per_pixel: f64,
    interpolation_mode: InterpolationMode,
) -> f64 {
    let cycle_frames = sequence_steps(frame_count, mode, interpolation_mode).len() as f64;
    let gif_bits_per_pixel = (source_bits_per_pixel * 1.25).clamp(4.0, 6.8);
    let estimated_bits = width as f64 * height as f64 * cycle_frames * gif_bits_per_pixel;
    (estimated_bits / 8_000_000.0 + 0.3).max(0.2)
}

fn save_intermediate_frame(
    prepared_dir: &Path,
    frame_index: usize,
    next_frame_index: usize,
    language: UiLanguage,
) -> Result<String, String> {
    let file_name = format!("mix_{frame_index:03}_{next_frame_index:03}.png");
    let output_path = prepared_dir.join(&file_name);
    if output_path.exists() {
        return Ok(file_name);
    }

    let current_path = prepared_dir.join(format!("frame_{frame_index:03}.png"));
    let next_path = prepared_dir.join(format!("frame_{next_frame_index:03}.png"));
    let current = image::open(&current_path)
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось прочитать подготовленный кадр",
                    "Failed to read the prepared frame"
                )
            )
        })?
        .to_rgba8();
    let next = image::open(&next_path)
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось прочитать подготовленный кадр",
                    "Failed to read the prepared frame"
                )
            )
        })?
        .to_rgba8();

    if current.dimensions() != next.dimensions() {
        return Err(tr(
            language,
            "Не удалось создать промежуточный кадр: размеры не совпадают",
            "Failed to create an intermediate frame: dimensions do not match",
        )
        .into());
    }

    let (width, height) = current.dimensions();
    let mut blended = RgbaImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let a = current.get_pixel(x, y).0;
            let b = next.get_pixel(x, y).0;
            blended.put_pixel(
                x,
                y,
                Rgba([
                    ((u16::from(a[0]) + u16::from(b[0])) / 2) as u8,
                    ((u16::from(a[1]) + u16::from(b[1])) / 2) as u8,
                    ((u16::from(a[2]) + u16::from(b[2])) / 2) as u8,
                    ((u16::from(a[3]) + u16::from(b[3])) / 2) as u8,
                ]),
            );
        }
    }

    blended.save(&output_path).map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Не удалось сохранить промежуточный кадр",
                "Failed to save the intermediate frame"
            )
        )
    })?;
    Ok(file_name)
}

fn prepared_step_file(
    prepared_dir: &Path,
    step: SequenceStep,
    language: UiLanguage,
) -> Result<String, String> {
    if step.blend && step.frame_index != step.next_frame_index {
        save_intermediate_frame(
            prepared_dir,
            step.frame_index,
            step.next_frame_index,
            language,
        )
    } else {
        Ok(format!("frame_{:03}.png", step.frame_index))
    }
}

fn smooth_filter(speed_ms: u64) -> String {
    let input_fps = 1000.0 / speed_ms.max(1) as f64;
    let output_fps = input_fps * 2.0;
    format!(
        "fps={input_fps:.5},minterpolate=fps={output_fps:.5}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
    )
}

fn smooth_picture_frame_count(frame_count: usize) -> usize {
    if frame_count > 1 {
        frame_count * 2 - 1
    } else {
        frame_count
    }
}

fn smooth_picture_pair_filter() -> String {
    "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,fps=10.00000,minterpolate=fps=20.00000:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1".into()
}

fn render_smooth_picture_middle_frame(
    app: &tauri::AppHandle,
    prepared_dir: &Path,
    frame_index: usize,
    next_frame_index: usize,
    language: UiLanguage,
) -> Result<PathBuf, String> {
    let smooth_dir = prepared_dir.join("smooth_pictures");
    fs::create_dir_all(&smooth_dir).map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Не удалось создать временную папку для smooth-кадров",
                "Failed to create a temporary folder for smooth frames"
            )
        )
    })?;

    let output_path = smooth_dir.join(format!("middle_{frame_index:03}_{next_frame_index:03}.png"));
    if output_path.exists() {
        return Ok(output_path);
    }

    let current_path = prepared_dir.join(format!("frame_{frame_index:03}.png"));
    let next_path = prepared_dir.join(format!("frame_{next_frame_index:03}.png"));
    let output_pattern = smooth_dir.join(format!(
        "pair_{frame_index:03}_{next_frame_index:03}_%03d.png"
    ));
    let mut args = vec!["-y".to_string()];
    for input_path in [&current_path, &current_path, &next_path, &next_path] {
        args.extend([
            "-loop".to_string(),
            "1".to_string(),
            "-t".to_string(),
            "0.10000".to_string(),
            "-i".to_string(),
            input_path.to_string_lossy().into_owned(),
        ]);
    }
    args.extend([
        "-filter_complex".to_string(),
        smooth_picture_pair_filter(),
        "-frames:v".to_string(),
        "7".to_string(),
        output_pattern.to_string_lossy().into_owned(),
    ]);
    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "FFmpeg не найден в комплекте приложения",
                    "Bundled FFmpeg was not found"
                )
            )
        })?
        .args(args);
    let output = tauri::async_runtime::block_on(command.output()).map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Не удалось запустить поставляемый FFmpeg",
                "Failed to launch the bundled FFmpeg"
            )
        )
    })?;
    if !output.status.success() {
        let error_tail = String::from_utf8_lossy(&output.stderr);
        return Err(match language {
            UiLanguage::Ru => format!("FFmpeg не смог создать smooth-кадры. {}", error_tail.trim()),
            UiLanguage::En => format!(
                "FFmpeg failed to create smooth frames. {}",
                error_tail.trim()
            ),
        });
    }

    let middle_path = smooth_dir.join(format!(
        "pair_{frame_index:03}_{next_frame_index:03}_004.png"
    ));
    if middle_path.exists() {
        fs::copy(&middle_path, &output_path).map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось сохранить smooth-кадр",
                    "Failed to save the smooth frame"
                )
            )
        })?;
        return Ok(output_path);
    }

    let mut files = fs::read_dir(&smooth_dir)
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось прочитать smooth-кадры",
                    "Failed to read the smooth frames"
                )
            )
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| {
                    name.starts_with(&format!("pair_{frame_index:03}_{next_frame_index:03}_"))
                })
        })
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("png"))
        .collect::<Vec<_>>();
    files.sort();
    let fallback_middle = files.get(files.len() / 2).ok_or_else(|| {
        tr(
            language,
            "Smooth-кадр не был создан",
            "The smooth frame was not created",
        )
        .to_string()
    })?;
    fs::copy(fallback_middle, &output_path).map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Не удалось сохранить smooth-кадр",
                "Failed to save the smooth frame"
            )
        )
    })?;
    Ok(output_path)
}

fn render_smooth_picture_frames(
    app: &tauri::AppHandle,
    prepared_dir: &Path,
    frame_count: usize,
    language: UiLanguage,
) -> Result<Vec<PathBuf>, String> {
    let mut source_paths = Vec::with_capacity(smooth_picture_frame_count(frame_count));
    for index in 0..frame_count {
        source_paths.push(prepared_dir.join(format!("frame_{index:03}.png")));
        if index + 1 < frame_count {
            source_paths.push(render_smooth_picture_middle_frame(
                app,
                prepared_dir,
                index,
                index + 1,
                language,
            )?);
        }
    }
    let expected = smooth_picture_frame_count(frame_count);
    if source_paths.len() != expected {
        return Err(match language {
            UiLanguage::Ru => format!(
                "Неверное количество кадров для PIC Smooth: ожидалось {}, получилось {}",
                expected,
                source_paths.len()
            ),
            UiLanguage::En => format!(
                "Wrong PIC Smooth frame count: expected {}, got {}",
                expected,
                source_paths.len()
            ),
        });
    }
    Ok(source_paths)
}

fn write_image_file(
    source_path: &Path,
    target_path: &Path,
    image_format: &str,
    language: UiLanguage,
) -> Result<(), String> {
    if image_format == "png" {
        fs::copy(source_path, target_path)
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "{}: {error}",
                    tr(
                        language,
                        "Не удалось сохранить кадр",
                        "Failed to save the frame"
                    )
                )
            })
    } else if image_format == "jpg" {
        let image = image::open(source_path).map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось прочитать подготовленный кадр",
                    "Failed to read the prepared frame"
                )
            )
        })?;
        let mut file = File::create(target_path).map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось создать JPG",
                    "Failed to create the JPG file"
                )
            )
        })?;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 95);
        encoder.encode_image(&image).map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось сохранить JPG",
                    "Failed to save the JPG file"
                )
            )
        })
    } else {
        let image = image::open(source_path).map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось прочитать подготовленный кадр",
                    "Failed to read the prepared frame"
                )
            )
        })?;
        image
            .save_with_format(target_path, image::ImageFormat::Tiff)
            .map_err(|error| {
                format!(
                    "{}: {error}",
                    tr(
                        language,
                        "Не удалось сохранить TIFF",
                        "Failed to save the TIFF file"
                    )
                )
            })
    }
}

#[tauri::command]
async fn prepare_smooth_preview(
    app: tauri::AppHandle,
    language_state: State<'_, LanguageState>,
    request: PreviewRequest,
) -> Result<Vec<String>, String> {
    let language = current_language(&language_state);
    validate_preview_request(&request, language)?;

    let request_for_worker = request.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let directory = tempfile::Builder::new()
            .prefix("wigglegram-preview-")
            .tempdir()
            .map_err(|error| error.to_string())?;
        let max_size = request_for_worker.max_size.unwrap_or(960);
        let scale = (max_size as f64
            / request_for_worker
                .crop
                .width
                .max(request_for_worker.crop.height) as f64)
            .min(1.0);
        let target_width = (request_for_worker.crop.width as f64 * scale)
            .round()
            .max(2.0) as u32;
        let target_height = (request_for_worker.crop.height as f64 * scale)
            .round()
            .max(2.0) as u32;
        let base = request_for_worker.frames[0].point.clone();

        for (index, frame) in request_for_worker.frames.iter().enumerate() {
            let image = decode_oriented(Path::new(&frame.path), language)?;
            let (actual_width, actual_height) = image.dimensions();
            if actual_width != frame.width || actual_height != frame.height {
                return Err(match language {
                    UiLanguage::Ru => format!("Размер \"{}\" изменился после импорта", frame.path),
                    UiLanguage::En => {
                        format!("The size of \"{}\" changed after import", frame.path)
                    }
                });
            }
            let mut canvas = RgbaImage::new(
                request_for_worker.crop.width,
                request_for_worker.crop.height,
            );
            let dx = (base.x - frame.point.x).round() as i64 - request_for_worker.crop.x;
            let dy = (base.y - frame.point.y).round() as i64 - request_for_worker.crop.y;
            imageops::overlay(&mut canvas, &image.to_rgba8(), dx, dy);
            let output = if canvas.width() != target_width || canvas.height() != target_height {
                imageops::resize(
                    &canvas,
                    target_width,
                    target_height,
                    imageops::FilterType::Lanczos3,
                )
            } else {
                canvas
            };
            output
                .save(directory.path().join(format!("frame_{index:03}.png")))
                .map_err(|error| {
                    format!(
                        "{}: {error}",
                        tr(
                            language,
                            "Не удалось подготовить кадр превью",
                            "Failed to prepare a preview frame"
                        )
                    )
                })?;
        }

        let order = sequence_indices(request_for_worker.frames.len(), &request_for_worker.mode);
        let concat_path = directory.path().join("sequence.ffconcat");
        let mut concat = File::create(&concat_path).map_err(|error| error.to_string())?;
        writeln!(concat, "ffconcat version 1.0").map_err(|error| error.to_string())?;
        let last = *order.last().ok_or_else(|| {
            tr(
                language,
                "Не удалось подготовить порядок превью",
                "Failed to prepare the preview order",
            )
            .to_string()
        })?;
        for frame_index in &order {
            writeln!(concat, "file 'frame_{frame_index:03}.png'")
                .map_err(|error| error.to_string())?;
            writeln!(
                concat,
                "duration {:.6}",
                request_for_worker.speed_ms as f64 / 1000.0
            )
            .map_err(|error| error.to_string())?;
        }
        writeln!(concat, "file 'frame_{last:03}.png'").map_err(|error| error.to_string())?;

        let output_pattern = directory.path().join("preview_%03d.jpg");
        let expected_count = sequence_steps(
            request_for_worker.frames.len(),
            &request_for_worker.mode,
            InterpolationMode::Smooth,
        )
        .len()
        .max(1);
        let total_seconds = gif_loop_duration_seconds(
            request_for_worker.frames.len(),
            &request_for_worker.mode,
            request_for_worker.speed_ms,
        );
        let args = vec![
            "-y".to_string(),
            "-f".to_string(),
            "concat".to_string(),
            "-safe".to_string(),
            "0".to_string(),
            "-i".to_string(),
            "sequence.ffconcat".to_string(),
            "-t".to_string(),
            format!("{total_seconds:.3}"),
            "-vf".to_string(),
            smooth_filter(request_for_worker.speed_ms),
            "-frames:v".to_string(),
            expected_count.to_string(),
            "-q:v".to_string(),
            "3".to_string(),
            output_pattern
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("preview_%03d.jpg")
                .to_string(),
        ];
        let command = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|error| {
                format!(
                    "{}: {error}",
                    tr(
                        language,
                        "FFmpeg не найден в комплекте приложения",
                        "Bundled FFmpeg was not found"
                    )
                )
            })?
            .current_dir(directory.path())
            .args(args);
        let output = tauri::async_runtime::block_on(command.output()).map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Не удалось запустить поставляемый FFmpeg",
                    "Failed to launch the bundled FFmpeg"
                )
            )
        })?;
        if !output.status.success() {
            let error_tail = String::from_utf8_lossy(&output.stderr);
            return Err(match language {
                UiLanguage::Ru => format!(
                    "FFmpeg не смог подготовить smooth-превью. {}",
                    error_tail.trim()
                ),
                UiLanguage::En => format!(
                    "FFmpeg failed to prepare the smooth preview. {}",
                    error_tail.trim()
                ),
            });
        }

        let mut files = fs::read_dir(directory.path())
            .map_err(|error| {
                format!(
                    "{}: {error}",
                    tr(
                        language,
                        "Не удалось прочитать кадры превью",
                        "Failed to read the preview frames"
                    )
                )
            })?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("jpg")
            })
            .collect::<Vec<_>>();
        files.sort_by_key(|entry| entry.file_name());
        if files.is_empty() {
            return Err(tr(
                language,
                "Smooth-превью не было создано",
                "Smooth preview was not created",
            )
            .into());
        }

        files
            .into_iter()
            .map(|entry| {
                fs::read(entry.path())
                    .map(|bytes| format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)))
                    .map_err(|error| {
                        format!(
                            "{}: {error}",
                            tr(
                                language,
                                "Не удалось прочитать кадр превью",
                                "Failed to read a preview frame"
                            )
                        )
                    })
            })
            .collect()
    })
    .await
    .map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Ошибка подготовки превью",
                "Preview preparation error"
            )
        )
    })?
}

fn prepare_export(
    app: &tauri::AppHandle,
    state: &ExportState,
    request: &ExportRequest,
    language: UiLanguage,
) -> Result<(tempfile::TempDir, PathBuf, f64), String> {
    validate_request(request, language)?;
    let interpolation_mode =
        resolve_interpolation_mode(&request.interpolation_mode).ok_or_else(|| {
            tr(
                language,
                "Неизвестный режим промежуточных кадров",
                "Unknown interpolation mode",
            )
            .to_string()
        })?;
    let directory = tempfile::Builder::new()
        .prefix("wigglegram-")
        .tempdir()
        .map_err(|error| error.to_string())?;
    let base = request.frames[0].point.clone();
    let target_width = (((request.crop.width as f64 * request.scale).round() as u32).max(2)) & !1;
    let target_height = (((request.crop.height as f64 * request.scale).round() as u32).max(2)) & !1;
    let effective_interpolation = if request.format != "pic" && request.frames.len() > 1 {
        interpolation_mode
    } else {
        InterpolationMode::Off
    };
    if request.format == "gif" {
        let estimated_size = estimate_gif_size_mb(
            target_width,
            target_height,
            request.frames.len(),
            &request.mode,
            source_image_bits_per_pixel(&request.frames),
            effective_interpolation,
        );
        if estimated_size > MAX_GIF_SIZE_MB {
            return Err(match language {
                UiLanguage::Ru => format!(
                    "GIF получится слишком тяжёлым (≈ {:.1} МБ). Уменьшите разрешение или выберите MP4.",
                    estimated_size
                ),
                UiLanguage::En => format!(
                    "This GIF would be too large (≈ {:.1} MB). Reduce the resolution or choose MP4.",
                    estimated_size
                ),
            });
        }
    }

    for (index, frame) in request.frames.iter().enumerate() {
        if state.cancelled.load(Ordering::Relaxed) {
            return Err(tr(
                language,
                "Экспорт отменён пользователем",
                "Export cancelled by the user",
            )
            .into());
        }
        app.emit(
            "export-progress",
            ExportProgress {
                percent: 5.0 + (index as f64 / request.frames.len() as f64) * 30.0,
                message: match language {
                    UiLanguage::Ru => format!(
                        "Подготовка кадра {} из {}…",
                        index + 1,
                        request.frames.len()
                    ),
                    UiLanguage::En => {
                        format!("Preparing frame {} of {}…", index + 1, request.frames.len())
                    }
                },
            },
        )
        .ok();
        let image = decode_oriented(Path::new(&frame.path), language)?;
        let (actual_width, actual_height) = image.dimensions();
        if actual_width != frame.width || actual_height != frame.height {
            return Err(match language {
                UiLanguage::Ru => format!("Размер \"{}\" изменился после импорта", frame.path),
                UiLanguage::En => format!("The size of \"{}\" changed after import", frame.path),
            });
        }
        let mut canvas = RgbaImage::new(request.crop.width, request.crop.height);
        let dx = (base.x - frame.point.x).round() as i64 - request.crop.x;
        let dy = (base.y - frame.point.y).round() as i64 - request.crop.y;
        imageops::overlay(&mut canvas, &image.to_rgba8(), dx, dy);
        let output = if canvas.width() != target_width || canvas.height() != target_height {
            imageops::resize(
                &canvas,
                target_width,
                target_height,
                imageops::FilterType::Lanczos3,
            )
        } else {
            canvas
        };
        output
            .save(directory.path().join(format!("frame_{index:03}.png")))
            .map_err(|error| {
                format!(
                    "{}: {error}",
                    tr(
                        language,
                        "Не удалось подготовить кадр",
                        "Failed to prepare a frame"
                    )
                )
            })?;
    }

    let original_steps =
        sequence_steps(request.frames.len(), &request.mode, InterpolationMode::Off);
    let blended_steps = sequence_steps(
        request.frames.len(),
        &request.mode,
        InterpolationMode::Blend,
    );
    let concat_path = directory.path().join("sequence.ffconcat");
    let mut concat = File::create(&concat_path).map_err(|error| error.to_string())?;
    writeln!(concat, "ffconcat version 1.0").map_err(|error| error.to_string())?;
    let frame_duration_seconds = if effective_interpolation == InterpolationMode::Blend {
        request.speed_ms as f64 / 2000.0
    } else {
        request.speed_ms as f64 / 1000.0
    };
    let total_ms = if request.format == "gif" {
        let steps = if effective_interpolation == InterpolationMode::Blend {
            &blended_steps
        } else {
            &original_steps
        };
        let last = *steps.last().ok_or_else(|| {
            tr(
                language,
                "Не удалось подготовить порядок GIF",
                "Failed to prepare the GIF order",
            )
            .to_string()
        })?;
        for step in steps {
            let file_name = if effective_interpolation == InterpolationMode::Blend {
                prepared_step_file(directory.path(), *step, language)?
            } else {
                format!("frame_{:03}.png", step.frame_index)
            };
            writeln!(concat, "file '{file_name}'").map_err(|error| error.to_string())?;
            writeln!(concat, "duration {:.6}", frame_duration_seconds)
                .map_err(|error| error.to_string())?;
        }
        writeln!(
            concat,
            "file '{}'",
            if effective_interpolation == InterpolationMode::Blend {
                prepared_step_file(directory.path(), last, language)?
            } else {
                format!("frame_{:03}.png", last.frame_index)
            }
        )
        .map_err(|error| error.to_string())?;
        (gif_loop_duration_seconds(request.frames.len(), &request.mode, request.speed_ms) * 1000.0)
            .round() as u64
    } else {
        let total_ms = (request.duration_seconds * 1000.0).round() as u64;
        let mut elapsed = 0_u64;
        let mut cursor = 0_usize;
        let mut last = String::new();
        let steps = if effective_interpolation == InterpolationMode::Blend {
            &blended_steps
        } else {
            &original_steps
        };
        let frame_duration_ms = if effective_interpolation == InterpolationMode::Blend {
            request.speed_ms / 2
        } else {
            request.speed_ms
        };
        while elapsed < total_ms {
            let step = steps[cursor % steps.len()];
            last = if effective_interpolation == InterpolationMode::Blend {
                prepared_step_file(directory.path(), step, language)?
            } else {
                format!("frame_{:03}.png", step.frame_index)
            };
            let duration = frame_duration_ms.min(total_ms - elapsed);
            writeln!(concat, "file '{last}'").map_err(|error| error.to_string())?;
            writeln!(concat, "duration {:.6}", duration as f64 / 1000.0)
                .map_err(|error| error.to_string())?;
            elapsed += duration;
            cursor += 1;
        }
        writeln!(concat, "file '{last}'").map_err(|error| error.to_string())?;
        total_ms
    };
    Ok((directory, concat_path, total_ms as f64 / 1000.0))
}

fn write_picture_set(
    app: &tauri::AppHandle,
    state: &ExportState,
    request: &ExportRequest,
    prepared_dir: &Path,
    output_dir: &Path,
    language: UiLanguage,
) -> Result<(), String> {
    if output_dir.exists() {
        return Err(tr(
            language,
            "Папка для набора кадров уже существует",
            "The image set folder already exists",
        )
        .into());
    }
    fs::create_dir_all(output_dir).map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Не удалось создать папку экспорта",
                "Failed to create the export folder"
            )
        )
    })?;

    let interpolation_mode =
        resolve_interpolation_mode(&request.interpolation_mode).ok_or_else(|| {
            tr(
                language,
                "Неизвестный режим промежуточных кадров",
                "Unknown interpolation mode",
            )
            .to_string()
        })?;
    let source_paths =
        if interpolation_mode == InterpolationMode::Smooth && request.frames.len() > 1 {
            render_smooth_picture_frames(app, prepared_dir, request.frames.len(), language)?
        } else {
            (0..request.frames.len())
                .map(|index| prepared_dir.join(format!("frame_{index:03}.png")))
                .collect::<Vec<_>>()
        };
    let total = source_paths.len().max(1);

    for (index, source_path) in source_paths.iter().enumerate() {
        if state.cancelled.load(Ordering::Relaxed) {
            let _ = fs::remove_dir_all(output_dir);
            return Err(tr(
                language,
                "Экспорт отменён пользователем",
                "Export cancelled by the user",
            )
            .into());
        }
        app.emit(
            "export-progress",
            ExportProgress {
                percent: 38.0 + ((index + 1) as f64 / total as f64) * 60.0,
                message: match language {
                    UiLanguage::Ru => format!("Сохранение кадра {} из {}…", index + 1, total),
                    UiLanguage::En => format!("Saving frame {} of {}…", index + 1, total),
                },
            },
        )
        .ok();

        let target_path =
            output_dir.join(format!("frame_{:03}.{}", index + 1, request.image_format));
        write_image_file(source_path, &target_path, &request.image_format, language)?;
    }

    Ok(())
}

#[tauri::command]
async fn export_video(
    app: tauri::AppHandle,
    state: State<'_, ExportState>,
    language_state: State<'_, LanguageState>,
    request: ExportRequest,
) -> Result<(), String> {
    let language = current_language(&language_state);
    state.cancelled.store(false, Ordering::Relaxed);
    let request_for_worker = request.clone();
    let app_for_worker = app.clone();
    let (directory, _, sequence_duration_seconds) =
        tauri::async_runtime::spawn_blocking(move || {
            let managed = app_for_worker.state::<ExportState>();
            prepare_export(
                &app_for_worker,
                managed.inner(),
                &request_for_worker,
                language,
            )
        })
        .await
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "Ошибка подготовки экспорта",
                    "Export preparation error"
                )
            )
        })??;

    if state.cancelled.load(Ordering::Relaxed) {
        return Err(tr(
            language,
            "Экспорт отменён пользователем",
            "Export cancelled by the user",
        )
        .into());
    }
    let output_path = PathBuf::from(&request.output_path);
    if request.format == "pic" {
        app.emit(
            "export-progress",
            ExportProgress {
                percent: 38.0,
                message: match language {
                    UiLanguage::Ru => {
                        format!("Сохранение {}…", request.image_format.to_uppercase())
                    }
                    UiLanguage::En => format!("Saving {}…", request.image_format.to_uppercase()),
                },
            },
        )
        .ok();

        let request_for_worker = request.clone();
        let output_path_for_worker = output_path.clone();
        let app_for_worker = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let managed = app_for_worker.state::<ExportState>();
            write_picture_set(
                &app_for_worker,
                managed.inner(),
                &request_for_worker,
                directory.path(),
                &output_path_for_worker,
                language,
            )
        })
        .await
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(language, "Ошибка экспорта кадров", "Image export error")
            )
        })??;

        *state.last_output.lock().map_err(|_| {
            tr(
                language,
                "Не удалось запомнить путь экспортированного файла",
                "Failed to store the exported result path",
            )
        })? = Some(output_path.clone());
        app.emit(
            "export-progress",
            ExportProgress {
                percent: 100.0,
                message: tr(language, "Готово", "Done").into(),
            },
        )
        .ok();
        return Ok(());
    }

    let encoding_message = if request.format == "gif" {
        tr(language, "Создание GIF…", "Creating GIF…")
    } else {
        tr(language, "Кодирование H.264…", "Encoding H.264…")
    };
    app.emit(
        "export-progress",
        ExportProgress {
            percent: 38.0,
            message: encoding_message.into(),
        },
    )
    .ok();

    if let Some(parent) = output_path.parent() {
        if !parent.exists() {
            return Err(tr(
                language,
                "Папка экспорта не существует",
                "The export folder does not exist",
            )
            .into());
        }
    }
    let interpolation_mode =
        resolve_interpolation_mode(&request.interpolation_mode).ok_or_else(|| {
            tr(
                language,
                "Неизвестный режим промежуточных кадров",
                "Unknown interpolation mode",
            )
            .to_string()
        })?;
    let smooth_interpolation =
        interpolation_mode == InterpolationMode::Smooth && request.frames.len() > 1;
    let smooth_filter_value = smooth_interpolation.then(|| smooth_filter(request.speed_ms));
    let mut args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        "sequence.ffconcat".to_string(),
        "-t".to_string(),
        format!("{:.3}", sequence_duration_seconds),
        "-an".to_string(),
    ];
    if request.format == "gif" {
        let filter_complex = if let Some(filter) = &smooth_filter_value {
            format!(
                "[0:v]{filter},split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle"
            )
        } else {
            "[0:v]split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle".to_string()
        };
        args.extend([
            "-filter_complex".to_string(),
            filter_complex,
            "-loop".to_string(),
            "0".to_string(),
        ]);
        if !smooth_interpolation {
            args.extend(["-fps_mode".to_string(), "vfr".to_string()]);
        }
    } else {
        if let Some(filter) = smooth_filter_value {
            args.extend(["-vf".to_string(), filter]);
        }
        args.extend([
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
        ]);
    }
    args.extend([
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        request.output_path.clone(),
    ]);
    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|error| {
            format!(
                "{}: {error}",
                tr(
                    language,
                    "FFmpeg не найден в комплекте приложения",
                    "Bundled FFmpeg was not found"
                )
            )
        })?
        .current_dir(directory.path())
        .args(args);
    let (mut events, child) = command.spawn().map_err(|error| {
        format!(
            "{}: {error}",
            tr(
                language,
                "Не удалось запустить поставляемый FFmpeg",
                "Failed to launch the bundled FFmpeg"
            )
        )
    })?;
    let mut child = Some(child);
    let mut output_buffer = String::new();
    let mut error_tail = String::new();
    let mut exit_code = None;

    while let Some(event) = events.recv().await {
        if state.cancelled.load(Ordering::Relaxed) {
            if let Some(process) = child.take() {
                let _ = process.kill();
            }
            let _ = fs::remove_file(&output_path);
            return Err(tr(
                language,
                "Экспорт отменён пользователем",
                "Export cancelled by the user",
            )
            .into());
        }
        match event {
            CommandEvent::Stdout(bytes) => {
                output_buffer.push_str(&String::from_utf8_lossy(&bytes));
                let lines: Vec<_> = output_buffer.split('\n').map(str::to_owned).collect();
                output_buffer = lines.last().cloned().unwrap_or_default();
                for line in lines.iter().take(lines.len().saturating_sub(1)) {
                    if let Some(value) = line
                        .strip_prefix("out_time_us=")
                        .and_then(|value| value.parse::<f64>().ok())
                    {
                        let encoded_seconds = value / 1_000_000.0;
                        let percent = 38.0
                            + (encoded_seconds / sequence_duration_seconds.max(0.001))
                                .clamp(0.0, 1.0)
                                * 60.0;
                        app.emit(
                            "export-progress",
                            ExportProgress {
                                percent,
                                message: encoding_message.into(),
                            },
                        )
                        .ok();
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                error_tail.push_str(&String::from_utf8_lossy(&bytes));
                if error_tail.len() > 6000 {
                    error_tail.drain(..error_tail.len() - 6000);
                }
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                return Err(format!(
                    "{}: {error}",
                    tr(language, "Ошибка FFmpeg", "FFmpeg error")
                ))
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        let _ = fs::remove_file(&output_path);
        return Err(match language {
            UiLanguage::Ru => format!(
                "FFmpeg завершился с ошибкой (код {:?}). {}",
                exit_code,
                error_tail.trim()
            ),
            UiLanguage::En => format!(
                "FFmpeg finished with an error (code {:?}). {}",
                exit_code,
                error_tail.trim()
            ),
        });
    }
    *state.last_output.lock().map_err(|_| {
        tr(
            language,
            "Не удалось запомнить путь экспортированного файла",
            "Failed to store the exported result path",
        )
    })? = Some(output_path.clone());
    app.emit(
        "export-progress",
        ExportProgress {
            percent: 100.0,
            message: tr(language, "Готово", "Done").into(),
        },
    )
    .ok();
    Ok(())
}

#[tauri::command]
fn cancel_export(state: State<'_, ExportState>) {
    state.cancelled.store(true, Ordering::Relaxed);
}

fn last_export_path(
    state: &State<'_, ExportState>,
    language: UiLanguage,
) -> Result<PathBuf, String> {
    let path = state
        .last_output
        .lock()
        .map_err(|_| {
            tr(
                language,
                "Не удалось получить путь экспортированного файла",
                "Failed to get the exported result path",
            )
        })?
        .clone()
        .ok_or_else(|| {
            tr(
                language,
                "Сначала экспортируйте результат",
                "Export something first",
            )
            .to_string()
        })?;
    if !path.exists() {
        return Err(tr(
            language,
            "Экспортированный результат больше не существует",
            "The exported result no longer exists",
        )
        .into());
    }
    Ok(path)
}

#[cfg(target_os = "macos")]
fn launch_export_path(path: &Path, reveal: bool, language: UiLanguage) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/open");
    if reveal {
        command.arg("-R");
    }
    command.arg(path).spawn().map(|_| ()).map_err(|error| {
        format!(
            "{} \"{}\": {error}",
            tr(language, "Не удалось открыть", "Failed to open"),
            path.display()
        )
    })
}

#[cfg(target_os = "macos")]
fn launch_url(url: &str, language: UiLanguage) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(
                    language,
                    "Не удалось открыть ссылку",
                    "Failed to open the link"
                ),
                url
            )
        })
}

#[cfg(target_os = "windows")]
fn launch_export_path(path: &Path, reveal: bool, language: UiLanguage) -> Result<(), String> {
    let mut command = if reveal {
        let mut command = Command::new("explorer.exe");
        command.arg(format!("/select,{}", path.display()));
        command
    } else {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command.arg(path);
        command
    };
    command.spawn().map(|_| ()).map_err(|error| {
        format!(
            "{} \"{}\": {error}",
            tr(language, "Не удалось открыть", "Failed to open"),
            path.display()
        )
    })
}

#[cfg(target_os = "windows")]
fn launch_url(url: &str, language: UiLanguage) -> Result<(), String> {
    Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(
                    language,
                    "Не удалось открыть ссылку",
                    "Failed to open the link"
                ),
                url
            )
        })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch_export_path(path: &Path, reveal: bool, language: UiLanguage) -> Result<(), String> {
    let target = if reveal {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(language, "Не удалось открыть", "Failed to open"),
                target.display()
            )
        })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch_url(url: &str, language: UiLanguage) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "{} \"{}\": {error}",
                tr(
                    language,
                    "Не удалось открыть ссылку",
                    "Failed to open the link"
                ),
                url
            )
        })
}

#[tauri::command]
fn open_exported_file(
    state: State<'_, ExportState>,
    language_state: State<'_, LanguageState>,
) -> Result<(), String> {
    let language = current_language(&language_state);
    launch_export_path(&last_export_path(&state, language)?, false, language)
}

#[tauri::command]
fn reveal_exported_file(
    state: State<'_, ExportState>,
    language_state: State<'_, LanguageState>,
) -> Result<(), String> {
    let language = current_language(&language_state);
    launch_export_path(&last_export_path(&state, language)?, true, language)
}

#[tauri::command]
fn open_github_repository(language_state: State<'_, LanguageState>) -> Result<(), String> {
    launch_url(GITHUB_REPOSITORY_URL, current_language(&language_state))
}

#[tauri::command]
fn open_github_releases(language_state: State<'_, LanguageState>) -> Result<(), String> {
    launch_url(GITHUB_RELEASES_URL, current_language(&language_state))
}

#[tauri::command]
fn next_export_path(
    language_state: State<'_, LanguageState>,
    directory: String,
    format: String,
) -> Result<String, String> {
    let language = current_language(&language_state);
    next_export_path_inner(directory, format, language)
}

fn next_export_path_inner(
    directory: String,
    format: String,
    language: UiLanguage,
) -> Result<String, String> {
    let directory = PathBuf::from(&directory);
    if !directory.is_dir() {
        return Err(tr(
            language,
            "Выбранная папка экспорта больше не существует",
            "The selected export folder no longer exists",
        )
        .into());
    }
    let extension = match format.as_str() {
        "mp4" => "mp4",
        "gif" => "gif",
        "pic" => "",
        _ => {
            return Err(tr(
                language,
                "Неизвестный формат экспорта",
                "Unknown export format",
            )
            .into())
        }
    };
    for index in 1..=999_999_u32 {
        let candidate = if format == "pic" {
            directory.join(format!("wigglegram_{index:03}"))
        } else {
            directory.join(format!("wigglegram_{index:03}.{extension}"))
        };
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err(tr(
        language,
        "В выбранной папке не осталось свободных имён для экспорта",
        "There are no free export names left in the selected folder",
    )
    .into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ExportState::default())
        .manage(LanguageState::default())
        .invoke_handler(tauri::generate_handler![
            load_images,
            set_language,
            prepare_smooth_preview,
            export_video,
            cancel_export,
            open_exported_file,
            reveal_exported_file,
            open_github_repository,
            open_github_releases,
            next_export_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running WiggleGram Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_path_uses_first_free_index() {
        let directory = tempfile::tempdir().unwrap();
        File::create(directory.path().join("wigglegram_001.mp4")).unwrap();
        File::create(directory.path().join("wigglegram_003.mp4")).unwrap();
        let path = next_export_path_inner(
            directory.path().to_string_lossy().into_owned(),
            "mp4".into(),
            UiLanguage::En,
        )
        .unwrap();
        assert!(path.ends_with("wigglegram_002.mp4"));

        let gif = next_export_path_inner(
            directory.path().to_string_lossy().into_owned(),
            "gif".into(),
            UiLanguage::En,
        )
        .unwrap();
        assert!(gif.ends_with("wigglegram_001.gif"));

        let pic = next_export_path_inner(
            directory.path().to_string_lossy().into_owned(),
            "pic".into(),
            UiLanguage::En,
        )
        .unwrap();
        assert!(pic.ends_with("wigglegram_001"));
    }

    #[test]
    fn gif_helpers_use_a_single_cycle_and_a_reasonable_estimate() {
        assert_eq!(sequence_len(4, "ping-pong"), 6);
        assert_eq!(sequence_len(3, "ping-pong"), 4);
        assert_eq!(sequence_len(2, "ping-pong"), 2);
        assert_eq!(sequence_len(4, "loop"), 4);
        assert_eq!(
            sequence_steps(4, "ping-pong", InterpolationMode::Blend).len(),
            12
        );
        assert_eq!(smooth_picture_frame_count(4), 7);
        assert_eq!(
            smooth_picture_pair_filter(),
            "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,fps=10.00000,minterpolate=fps=20.00000:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
        );
        assert!((gif_loop_duration_seconds(4, "ping-pong", 110) - 0.66).abs() < 0.001);

        let frames = vec![
            ExportFrame {
                path: String::new(),
                width: 2397,
                height: 3231,
                file_size_bytes: 4_490_497,
                point: Point { x: 0.0, y: 0.0 },
            },
            ExportFrame {
                path: String::new(),
                width: 2397,
                height: 3231,
                file_size_bytes: 4_310_773,
                point: Point { x: 0.0, y: 0.0 },
            },
            ExportFrame {
                path: String::new(),
                width: 2397,
                height: 3231,
                file_size_bytes: 4_250_681,
                point: Point { x: 0.0, y: 0.0 },
            },
            ExportFrame {
                path: String::new(),
                width: 2397,
                height: 3231,
                file_size_bytes: 4_211_182,
                point: Point { x: 0.0, y: 0.0 },
            },
        ];
        let estimate = estimate_gif_size_mb(
            2397,
            3231,
            frames.len(),
            "ping-pong",
            source_image_bits_per_pixel(&frames),
            InterpolationMode::Off,
        );
        let smoothed = estimate_gif_size_mb(
            2397,
            3231,
            frames.len(),
            "ping-pong",
            source_image_bits_per_pixel(&frames),
            InterpolationMode::Smooth,
        );
        assert!(estimate > 30.0);
        assert!(estimate < 35.0);
        assert!(smoothed > estimate);
    }
}
