use std::slice;

const fn unpremultiply_table() -> [u8; 65_536] {
    let mut table = [0; 65_536];
    let mut alpha = 1;
    while alpha < 256 {
        let mut value = 0;
        while value < 256 {
            let straight = (value * 255 + alpha / 2) / alpha;
            table[alpha * 256 + value] = if straight > 255 { 255 } else { straight as u8 };
            value += 1;
        }
        alpha += 1;
    }
    table
}

// Positive integer inputs make this identical to Math.min(255, Math.round(v * 255 / a)).
static UNPREMULTIPLY: [u8; 65_536] = unpremultiply_table();

#[no_mangle]
pub unsafe extern "C" fn video_straight_rgba(data: *mut u8, byte_length: usize, bgra: u32, premultiplied: u32) -> u32 {
    let length = byte_length - byte_length % 4;
    if length == 0 { return 0; }
    let pixels = slice::from_raw_parts_mut(data, length);
    if premultiplied != 0 {
        for pixel in pixels.chunks_exact_mut(4) {
            let alpha = (pixel[3] as usize) << 8;
            let red = UNPREMULTIPLY[alpha + pixel[if bgra != 0 { 2 } else { 0 }] as usize];
            let green = UNPREMULTIPLY[alpha + pixel[1] as usize];
            let blue = UNPREMULTIPLY[alpha + pixel[if bgra != 0 { 0 } else { 2 }] as usize];
            pixel[0] = red;
            pixel[1] = green;
            pixel[2] = blue;
        }
    } else if bgra != 0 {
        for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); }
    }
    length as u32
}

fn clamp_byte(value: f64) -> u8 {
    if value.is_nan() || value <= 0.0 { return 0; }
    if value >= 255.0 { return 255; }
    let floor = value.floor();
    let remainder = value - floor;
    if remainder > 0.5 || (remainder == 0.5 && floor as u8 % 2 == 1) { floor as u8 + 1 } else { floor as u8 }
}

fn straight_number(value: f64, alpha: f64, premultiplied: bool) -> u8 {
    if !premultiplied { return clamp_byte(value); }
    if alpha == 0.0 { return 0; }
    if alpha < 255.0 {
        let scaled = value * 255.0 / alpha;
        // Math.round chooses positive infinity at a tie; Uint8ClampedArray then clamps.
        let floor = scaled.floor();
        let rounded = if scaled - floor >= 0.5 { floor + 1.0 } else { floor };
        return clamp_byte(rounded);
    }
    clamp_byte(value)
}

// The public ArrayLike adapter also accepts sparse, fractional and nonfinite values.
#[no_mangle]
pub unsafe extern "C" fn video_straight_rgba_f64(input: *const f64, value_count: usize, bgra: u32, premultiplied: u32, output: *mut u8) -> u32 {
    let length = value_count - value_count % 4;
    if length == 0 { return 0; }
    let input = slice::from_raw_parts(input, length);
    let output = slice::from_raw_parts_mut(output, length);
    for (pixel, target) in input.chunks_exact(4).zip(output.chunks_exact_mut(4)) {
        let alpha = pixel[3];
        target[0] = straight_number(pixel[if bgra != 0 { 2 } else { 0 }], alpha, premultiplied != 0);
        target[1] = straight_number(pixel[1], alpha, premultiplied != 0);
        target[2] = straight_number(pixel[if bgra != 0 { 0 } else { 2 }], alpha, premultiplied != 0);
        target[3] = clamp_byte(alpha);
    }
    length as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_conversion_keeps_alpha_and_channel_order() {
        let mut pixels = [0, 0, 128, 128, 12, 34, 56, 0, 1, 2, 3, 255];
        unsafe { video_straight_rgba(pixels.as_mut_ptr(), pixels.len(), 1, 1); }
        assert_eq!(pixels, [255, 0, 0, 128, 0, 0, 0, 0, 3, 2, 1, 255]);
    }

    #[test]
    fn clamp_uses_even_ties() {
        assert_eq!(clamp_byte(0.5), 0);
        assert_eq!(clamp_byte(1.5), 2);
        assert_eq!(clamp_byte(2.5), 2);
        assert_eq!(clamp_byte(f64::NAN), 0);
        assert_eq!(clamp_byte(f64::INFINITY), 255);
    }
}
