use regex::Regex;
use std::sync::OnceLock;

const SIZE_UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];

static SIZE_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_multiplier(unit: &str) -> Option<f64> {
    match unit {
        "b" => Some(1.0),
        "kb" => Some(1024.0),
        "mb" => Some(1024.0_f64.powi(2)),
        "gb" => Some(1024.0_f64.powi(3)),
        "tb" => Some(1024.0_f64.powi(4)),
        "pb" => Some(1024.0_f64.powi(5)),
        _ => None,
    }
}

pub fn parse_size(size_str: &str) -> Result<u64, String> {
    let normalized = size_str.to_lowercase().replace(" ", "");

    if let Ok(num) = normalized.parse::<f64>() {
        return Ok(num as u64);
    }

    let regex = SIZE_REGEX.get_or_init(|| Regex::new(r"^([\d\.]+)(b|kb|mb|gb|tb|pb)$").unwrap());

    if let Some(caps) = regex.captures(&normalized) {
        let scalar_str = caps.get(1).map_or("", |m| m.as_str());
        let unit_str = caps.get(2).map_or("", |m| m.as_str());

        if let Ok(scalar) = scalar_str.parse::<f64>() {
            if let Some(multiplier) = get_multiplier(unit_str) {
                return Ok((scalar * multiplier) as u64);
            }
        }
    }

    Err(format!("Invalid size format: {}", size_str))
}

pub fn format_size(size_in_bytes: u64) -> String {
    let mut current_value = size_in_bytes as f64;

    for unit in SIZE_UNITS.iter() {
        if current_value < 1024.0 {
            if *unit == "B" {
                return format!("{} {}", current_value as u64, unit);
            }
            return format!("{:.2} {}", current_value, unit);
        }
        current_value /= 1024.0;
    }

    format!("{:.2} PB", current_value)
}

pub fn normalize_size(size_str: &str) -> String {
    match parse_size(size_str) {
        Ok(bytes) => format_size(bytes),
        Err(_) => size_str.to_string(),
    }
}
