/*
 * Parsing and human-friendly formatting of byte sizes with metric prefixes.
 * Owned by: core
 * Key deps: regex, once_cell
 * Invariants: Parsed values are non-negative; case-insensitive with whitespace tolerance.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

#![allow(dead_code)]

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

// ─── Tests ─────────────────────────────────────────────────────────────────
// Tests for size parsing and formatting functionality.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_size_kb() {
        assert_eq!(parse_size("1KB").unwrap(), 1024);
    }

    #[test]
    fn test_parse_size_mb() {
        assert_eq!(parse_size("5MB").unwrap(), 5 * 1024 * 1024);
    }

    #[test]
    fn test_parse_size_gb() {
        assert_eq!(parse_size("2GB").unwrap(), 2 * 1024 * 1024 * 1024);
    }

    #[test]
    fn test_parse_size_tb() {
        assert_eq!(parse_size("1TB").unwrap(), 1024_u64.pow(4));
    }

    #[test]
    fn test_parse_size_pb() {
        assert_eq!(parse_size("1PB").unwrap(), 1024_u64.pow(5));
    }

    #[test]
    fn test_parse_size_fractional_mb() {
        assert_eq!(parse_size("1.5MB").unwrap(), (1.5 * 1024.0 * 1024.0) as u64);
    }

    #[test]
    fn test_parse_size_whitespace_tolerance() {
        assert_eq!(parse_size(" 10 MB ").unwrap(), 10 * 1024 * 1024);
    }

    #[test]
    fn test_parse_size_raw_number() {
        assert_eq!(parse_size("1024").unwrap(), 1024);
    }

    #[test]
    fn test_parse_size_bad() {
        assert!(parse_size("bad").is_err());
    }

    #[test]
    fn test_parse_size_empty() {
        assert!(parse_size("").is_err());
    }

    #[test]
    fn test_format_size_zero() {
        assert_eq!(format_size(0), "0 B");
    }

    #[test]
    fn test_format_size_kb() {
        assert_eq!(format_size(1024), "1.00 KB");
    }

    #[test]
    fn test_format_size_mb() {
        assert_eq!(format_size(1048576), "1.00 MB");
    }

    #[test]
    fn test_normalize_size_invalid_passthrough() {
        assert_eq!(normalize_size("invalid"), "invalid");
    }
}
