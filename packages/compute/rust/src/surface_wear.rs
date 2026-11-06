use crate::material::hash;
use std::slice;

const EDGE_METERS: f64 = 0.06;
const BASE_METERS: f64 = 0.38;
const DRIP_METERS: f64 = 1.2;
const DRIP_WIDTH: f64 = 0.065;
const NOISE_COLUMNS: usize = 23;
const NOISE_ROWS: usize = 4;

fn clamp(value: f64) -> f64 { value.max(0.0).min(1.0) }
fn mix(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }
fn smooth(value: f64) -> f64 { value * value * (3.0 - 2.0 * value) }

fn lattice(seed: u32) -> [f64; 120] {
    let mut values = [0.0; 120];
    for y in 0..=NOISE_ROWS {
        for x in 0..=NOISE_COLUMNS {
            values[y * 24 + x] = hash(seed, (x % NOISE_COLUMNS) as u32, (y % NOISE_ROWS) as u32, 401) as f64 / 4294967295.0;
        }
    }
    values
}

fn noise(grid: &[f64; 120], u: f64, v: f64) -> f64 {
    let x = u * NOISE_COLUMNS as f64;
    let y = v * NOISE_ROWS as f64;
    let floor_x = x.floor();
    let floor_y = y.floor();
    let tx = smooth(x - floor_x);
    let ty = smooth(y - floor_y);
    let at = (floor_y as usize % NOISE_ROWS) * 24 + floor_x as usize % NOISE_COLUMNS;
    mix(mix(grid[at], grid[at + 1], tx), mix(grid[at + 24], grid[at + 25], tx), ty)
}

fn sample(data: &[u8], indices: [usize; 4], tx: f64, ty: f64, channel: usize) -> f64 {
    (data[indices[0] + channel] as f64 * (1.0 - tx) + data[indices[1] + channel] as f64 * tx) * (1.0 - ty)
        + (data[indices[2] + channel] as f64 * (1.0 - tx) + data[indices[3] + channel] as f64 * tx) * ty
}

/// Color and AO atlases retain the legacy Float32 mask boundary before sampling.
#[no_mangle]
pub unsafe extern "C" fn surface_wear(config: *const f64, openings: *const f64, opening_count: usize,
    color: *const u8, ao: *const u8, base_width: usize, base_height: usize,
    pixels_x: usize, pixels_y: usize, seed: u32, output: *mut u8) -> u32 {
    if [base_width, base_height, pixels_x, pixels_y].iter().any(|value| *value == 0 || *value > 4096) || opening_count > 32 { return 1; }
    let c = slice::from_raw_parts(config, 11);
    if c.iter().any(|value| !value.is_finite()) || c[0] <= 0.0 || c[1] <= 0.0 || c[2] <= 0.0 || c[3] <= 0.0 { return 1; }
    let openings = slice::from_raw_parts(openings, opening_count * 3);
    let base_length = base_width * base_height * 4;
    let color = slice::from_raw_parts(color, base_length);
    let ao = slice::from_raw_parts(ao, base_length);
    let atlas_length = pixels_x * pixels_y * 4;
    let (color_out, ao_out) = slice::from_raw_parts_mut(output, atlas_length * 2).split_at_mut(atlas_length);
    let grid = lattice(seed);
    // Runoff's horizontal falloff is independent of the row; evaluate exp once per column/opening.
    let mut drips = vec![0.0; opening_count * pixels_x];
    let mut bottoms = Vec::with_capacity(opening_count);
    for (index, opening) in openings.chunks_exact(3).enumerate() {
        let left = opening[0] * c[9];
        let right = (opening[0] + opening[2]) * c[9];
        bottoms.push(opening[1] * c[10]);
        for x in 0..pixels_x {
            let px = (x as f64 + 0.5) / pixels_x as f64 * c[0];
            let corner = (px - left).abs().min((px - right).abs());
            let ratio = corner / DRIP_WIDTH;
            let drip = (-(ratio * ratio)).exp() * 0.9;
            let wash = if px >= left && px <= right { 0.12 } else { 0.0 };
            drips[index * pixels_x + x] = drip + wash;
        }
    }
    for y in 0..pixels_y {
        for x in 0..pixels_x {
            let px = (x as f64 + 0.5) / pixels_x as f64 * c[0];
            let py = (y as f64 + 0.5) / pixels_y as f64 * c[1];
            let irregular = 0.45 + noise(&grid, px / c[0], py / c[1]) * 0.55;
            let mut dirt = clamp(1.0 - py / BASE_METERS) * 0.42;
            dirt += clamp(1.0 - px.min(c[0] - px).min(c[1] - py) / EDGE_METERS) * 0.12;
            for (index, bottom) in bottoms.iter().enumerate() {
                let below = bottom - py;
                if below < 0.0 || below > DRIP_METERS { continue; }
                dirt += drips[index * pixels_x + x] * (1.0 - below / DRIP_METERS) * irregular;
            }
            let mask = clamp(dirt * c[8]) as f32 as f64;
            let u = (px - c[0] / 2.0) / c[2];
            let v = py / c[3];
            let tu = c[4] * u + c[5] * v + c[6];
            let tv = -c[5] * u + c[4] * v + c[7];
            let sample_x = ((tu % 1.0 + 1.0) % 1.0) * base_width as f64 - 0.5;
            let sample_y = ((tv % 1.0 + 1.0) % 1.0) * base_height as f64 - 0.5;
            let left = sample_x.floor();
            let bottom = sample_y.floor();
            let tx = sample_x - left;
            let ty = sample_y - bottom;
            let x0 = (left as isize + base_width as isize) as usize % base_width;
            let x1 = (x0 + 1) % base_width;
            let y0 = (bottom as isize + base_height as isize) as usize % base_height;
            let y1 = (y0 + 1) % base_height;
            let indices = [(y0 * base_width + x0) * 4, (y0 * base_width + x1) * 4,
                (y1 * base_width + x0) * 4, (y1 * base_width + x1) * 4];
            let at = (y * pixels_x + x) * 4;
            for channel in 0..3 {
                color_out[at + channel] = (sample(color, indices, tx, ty, channel) * (1.0 - mask * 0.5)).round() as u8;
                ao_out[at + channel] = (sample(ao, indices, tx, ty, channel) * (1.0 - mask * 0.28)).round() as u8;
            }
            color_out[at + 3] = 255;
            ao_out[at + 3] = 255;
        }
    }
    0
}
