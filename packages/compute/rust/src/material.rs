use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

type Color = [f64; 3];
const NAMES: [&str; 16] = ["painted-concrete", "wall-tile", "brick", "granite", "pavers", "asphalt", "kerb", "wood-planks", "corrugated-metal", "aluminium", "glass", "awning-fabric", "emissive-acrylic", "plastic", "rubber", "rust"];
pub(crate) fn hash(seed: u32, x: u32, y: u32, salt: u32) -> u32 {
    let mut value = seed ^ x.wrapping_mul(0x9e3779b1) ^ y.wrapping_mul(0x85ebca77) ^ salt.wrapping_mul(0xc2b2ae3d);
    value = (value ^ (value >> 16)).wrapping_mul(0x7feb352d);
    value = (value ^ (value >> 15)).wrapping_mul(0x846ca68b);
    value ^ (value >> 16)
}
fn unit(seed: u32, x: f64, y: f64, salt: u32) -> f64 { hash(seed, x as i64 as u32, y as i64 as u32, salt) as f64 / 4294967295.0 }
fn clamp(x: f64) -> f64 { x.max(0.0).min(1.0) }
fn fract(x: f64) -> f64 { x - x.floor() }
fn mix(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }
fn color(a: Color, b: Color, t: f64) -> Color { [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)] }
fn smooth(x: f64) -> f64 { x * x * (3.0 - 2.0 * x) }
fn round(x: f64) -> f64 { (x + 0.5).floor() }
fn byte(x: f64) -> u8 { round(x).max(0.0).min(255.0) as u8 }
fn rgba(data: &mut [u8], index: usize, rgb: Color) { let at = index * 4; data[at] = byte(rgb[0]); data[at + 1] = byte(rgb[1]); data[at + 2] = byte(rgb[2]); data[at + 3] = 255; }
#[derive(Default)]
struct GridHasher(u64);
impl Hasher for GridHasher {
    fn finish(&self) -> u64 { self.0 }
    fn write(&mut self, bytes: &[u8]) { for byte in bytes { self.0 = self.0.wrapping_mul(31).wrapping_add(*byte as u64); } }
    fn write_u64(&mut self, value: u64) { self.0 = value.wrapping_mul(0x9e3779b97f4a7c15); }
}
struct Noise { seed: u32, grids: HashMap<u64, Vec<f64>, BuildHasherDefault<GridHasher>> }
impl Noise {
    fn sample(&mut self, u: f64, v: f64, columns: usize, rows: usize, salt: u32) -> f64 {
        let seed = self.seed;
        let stride = columns + 1;
        let key = ((columns as u64) << 32) | ((rows as u64) << 16) | salt as u64;
        let grid = self.grids.entry(key).or_insert_with(|| {
            let mut grid = vec![0.0; stride * (rows + 1)];
            for y in 0..=rows { for x in 0..=columns { grid[y * stride + x] = unit(seed, (x % columns) as f64, (y % rows) as f64, salt); } }
            grid
        });
        let x = u * columns as f64; let y = v * rows as f64;
        let fx = x.floor(); let fy = y.floor();
        let left = if fx >= 0.0 && fx < columns as f64 { fx as usize } else { ((fx as i64 % columns as i64 + columns as i64) % columns as i64) as usize };
        let top = if fy >= 0.0 && fy < rows as f64 { fy as usize } else { ((fy as i64 % rows as i64 + rows as i64) % rows as i64) as usize };
        let tx = smooth(x - fx); let ty = smooth(y - fy); let at = top * stride + left;
        mix(mix(grid[at], grid[at + 1], tx), mix(grid[at + stride], grid[at + stride + 1], tx), ty)
    }
}
struct Context { preset: usize, seed: u32, size: usize, c: [f64; 24], primary: Color, secondary: Color, accent: Color, noise: Noise }
#[derive(Clone, Copy)]
struct Sample { color: Color, height: f64, cavity: f64, edge: f64, roughness: f64 }
impl Context {
    fn repeats(&self, count: f64) -> usize { round(count * self.c[1]).min((self.size / 3) as f64).max(1.0) as usize }
    fn noise(&mut self, u: f64, v: f64, x: f64, y: f64, salt: u32) -> f64 { self.noise.sample(u, v, self.repeats(x), self.repeats(y), salt) }
    fn fbm(&mut self, u: f64, v: f64, x: usize, y: usize, salt: u32) -> f64 {
        let limit = (self.size / 3).max(4); let mut sum = 0.0; let mut total = 0.0; let mut amplitude = 1.0;
        for octave in 0..4 { sum += self.noise.sample(u, v, limit.min(x * (1 << octave)), limit.min(y * (1 << octave)), salt + octave) * amplitude; total += amplitude; amplitude *= 0.48; }
        sum / total
    }
    fn masonry(&self, u: f64, v: f64, columns: f64, rows: f64, stagger: bool, interlock: bool, grain: f64, s: &mut Sample) {
        let rc = if stagger { (round(self.repeats(rows) as f64 / 2.0) * 2.0).max(2.0) } else { self.repeats(rows) as f64 };
        let cc = self.repeats(columns) as f64; let row = (v * rc).floor(); let fy = fract(v * rc);
        let offset = if interlock && fy > 0.25 && fy < 0.75 { 0.13 } else { 0.0 };
        let shifted = u * cc + if stagger { (row % 2.0) * 0.5 } else { 0.0 } + offset;
        let column = shifted.floor(); let fx = fract(shifted);
        let dx = fx.min(1.0 - fx) * self.c[8] / cc; let dy = fy.min(1.0 - fy) * self.c[9] / rc;
        let grout = self.c[5];
        let distance = if interlock { joint_distance(fract(shifted - offset), fy, self.c[8] / cc, self.c[9] / rc) } else { dx.min(dy) };
        let texel = (if interlock { self.c[8].max(self.c[9]) } else if dx < dy { self.c[8] } else { self.c[9] }) / self.size as f64;
        let bevel = if self.preset == 4 { 0.003 } else if self.preset == 1 { 0.0008 } else { 0.0015 };
        let half = grout / 2.0; let radius = texel / 2.0;
        let coverage = (half.min(distance + radius) - (-half).max(distance - radius)).max(0.0) / texel;
        let ramp = clamp((half + bevel + radius * 0.5 - distance) / (bevel + radius * 0.5));
        s.cavity = smooth(ramp); s.edge = clamp(1.0 - distance / (grout * 3.0));
        let variation = unit(self.seed, (column + cc) % cc, row, 10);
        let amount = if self.preset == 4 { if (column + row) % 2.0 == 0.0 { 0.0 } else { 1.0 } } else { variation * self.c[2] };
        s.color = color(color(self.primary, self.secondary, amount), self.accent, coverage);
        s.height = 0.62 - s.cavity * if self.preset == 4 { 0.14 } else { 0.36 } + (grain - 0.5) * if self.preset == 1 { 0.025 } else if self.preset == 4 { 0.03 } else { 0.065 };
        s.roughness += s.cavity * 0.16 + (variation - 0.5) * 0.1;
    }
    fn sample(&mut self, u: f64, v: f64) -> Sample {
        let grain = self.noise(u, v, 128.0, 128.0, 1); let cloud = self.noise(u, v, 7.0, 7.0, 2); let broad = self.noise(u, v, 3.0, 3.0, 3);
        let contrast = self.c[2];
        let mut s = Sample { color: color(self.primary, self.secondary, clamp((grain * 0.14 + cloud * 0.14) * contrast)), height: 0.5 + (grain - 0.5) * 0.065, cavity: 0.0, edge: 0.0, roughness: (grain - 0.5) * 0.08 };
        match self.preset {
            1 => self.masonry(u, v, 4.0, 4.0, false, false, grain, &mut s),
            2 => self.masonry(u, v, 4.0, 6.0, true, false, grain, &mut s),
            4 => self.masonry(u, v, 6.0, 6.0, true, true, grain, &mut s),
            0 => { let pores = clamp((0.38 - grain) * 4.0); s.cavity = pores * 0.22; s.height += (cloud - 0.5) * 0.12 - pores * 0.035; s.color = color(s.color, self.secondary, (broad * 0.22 + pores * 0.16) * contrast); }
            3 => { let chips = unit(self.seed, (u * self.repeats(128.0) as f64).floor(), (v * self.repeats(128.0) as f64).floor(), 14); s.color = color(self.primary, if chips > 0.6 { self.accent } else { self.secondary }, (chips - 0.5).abs() * 1.7 * contrast); s.height += (chips - 0.5) * 0.12; s.cavity = clamp(0.25 - chips) * 0.4; }
            5 => { let aggregate = unit(self.seed, (u * self.repeats(192.0) as f64).floor(), (v * self.repeats(192.0) as f64).floor(), 15); let stone = clamp((aggregate - 0.6) * 2.5); s.color = color(self.primary, self.secondary, stone * contrast); s.height += stone * 0.18 + (cloud - 0.5) * 0.05; s.cavity = (1.0 - stone) * 0.24; }
            6 => { let seam = u.min(1.0 - u) * self.c[8]; s.cavity = clamp(1.0 - seam / self.c[5]); s.edge = clamp(1.0 - v.min(1.0 - v) * 16.0); s.height += (cloud - 0.5) * 0.08 - s.cavity * 0.2 - s.edge * 0.06; s.color = color(s.color, self.accent, s.cavity * 0.65); }
            7 => { let plank = fract(u * self.repeats(6.0) as f64); let warp = self.noise(u, v, 4.0, 2.0, 20) * 0.04; let fibers = self.noise.sample(u + warp, v, self.repeats(96.0), self.repeats(3.0), 21); s.cavity = clamp(1.0 - plank.min(1.0 - plank) / 0.035); s.edge = clamp(1.0 - plank.min(1.0 - plank) / 0.1); s.color = color(color(self.primary, self.secondary, fibers * contrast), self.accent, s.cavity); s.height += (fibers - 0.5) * 0.15 - s.cavity * 0.25; }
            8 => { let wave = (fract(u * self.repeats(10.0) as f64) * 2.0 - 1.0).abs(); let ridge = smooth(wave); s.height = 0.25 + ridge * 0.5 + (grain - 0.5) * 0.02; s.cavity = (1.0 - ridge) * 0.28; s.edge = s.cavity; s.color = color(self.primary, self.secondary, (1.0 - ridge) * 0.18 * contrast + broad * 0.12); }
            9 => { let brush = self.noise(u, v, 256.0, 4.0, 25); s.height += (brush - 0.5) * 0.1; s.color = color(self.primary, self.secondary, brush * contrast * 0.3); s.roughness += (brush - 0.5) * 0.1; }
            10 => { s.height = 0.5 + (grain - 0.5) * 0.07; s.roughness *= 0.1; if self.c[7] != 0.0 { s.color = glass(self.seed, u, v, self.primary); } }
            11 => { let stripes = (round(self.c[8] / self.c[6] / 2.0 * self.c[1]) * 2.0).max(2.0); let stripe = (u * stripes).floor() % 2.0; let weave = ((u * self.repeats(192.0) as f64).floor() + (v * self.repeats(192.0) as f64).floor()) % 2.0; s.color = color(if stripe == 0.0 { self.primary } else { self.secondary }, self.accent, weave * 0.025); s.height += (weave - 0.5) * 0.035 + (self.noise(u, v, 3.0, 12.0, 26) - 0.5) * 0.04; }
            12 => { s.height += (cloud - 0.5) * 0.025; s.roughness *= 0.4; }
            13 => { s.height += (cloud - 0.5) * 0.035; s.roughness *= 0.5; }
            14 => { s.cavity = clamp(0.35 - grain) * 0.2; s.height += (cloud - 0.5) * 0.04; }
            15 => { let oxide = clamp((cloud - 0.35) * 2.2); s.color = color(color(self.secondary, self.primary, oxide), self.accent, broad * contrast * oxide); s.height += oxide * 0.26 + (grain - 0.5) * 0.1; s.cavity = (1.0 - oxide) * 0.3; s.roughness += oxide * 0.06; }
            _ => {}
        }
        self.refine(u, v, &mut s); s
    }
    fn refine(&mut self, u: f64, v: f64, s: &mut Sample) {
        let contrast = self.c[2];
        match self.preset {
            0 => { let mac = self.fbm(u, v, 3, 3, 61); let meso = self.fbm(u, v, 15, 15, 66); let micro = self.fbm(u, v, 52, 52, 71); let pore = clamp((0.3 - micro) * 6.0); let trowel = self.fbm(u, v, 9, 3, 76); s.color = color(self.primary, self.secondary, clamp((mac * 0.2 + meso * 0.12 + pore * 0.14) * contrast)); s.height = 0.5 + (trowel - 0.5) * 0.17 + (micro - 0.5) * 0.045 - pore * 0.045; s.cavity = pore * 0.24; s.roughness = (meso - 0.5) * 0.11 + pore * 0.06; }
            7 => { let count = round(6.0 * self.c[1]).max(1.0); let plank = (u * count).floor(); let across = fract(u * count); let kx = 0.2 + unit(self.seed, plank, 0.0, 81) * 0.6; let ky = 0.15 + unit(self.seed, plank, 0.0, 82) * 0.7; let dx = across - kx; let dy = (v - ky) * 4.0; let knot = (-(dx * dx * 17.0 + dy * dy * 7.0)).exp(); let warp = self.fbm(u, v, 4, 2, 83) * 0.018 + knot * (dy * 4.0).sin() * 0.022; let grain = self.fbm(u + warp, v, 48, 2, 87); let rings = ((u + warp) * (self.size / 3).max(4).min(110) as f64 * std::f64::consts::PI * 2.0).sin() * 0.5 + 0.5; let tint = unit(self.seed, plank, 0.0, 91) * 0.2; s.color = color(self.primary, self.secondary, clamp((grain * 0.62 + rings * 0.18 + knot * 0.35 + tint) * contrast)); s.color = color(s.color, self.accent, s.cavity * 0.75); s.height = 0.5 + (grain - 0.5) * 0.09 + (rings - 0.5) * 0.012 - s.cavity * 0.3 - knot * 0.025; s.roughness = (grain - 0.5) * 0.12 + knot * 0.04 + s.cavity * 0.12; }
            8 | 9 => { let mac = self.fbm(u, v, 3, 3, 61); let brush = self.fbm(u, v, (self.size / 3).max(4).min(100), 3, 93); let scuff = clamp((self.fbm(u, v, 24, 2, 97) - 0.62) * 3.0); s.color = color(self.primary, self.secondary, (mac * 0.08 + brush * 0.13 + scuff * 0.2) * contrast); s.height += (brush - 0.5) * 0.012 - scuff * 0.015; s.roughness += (brush - 0.5) * 0.055 + scuff * 0.12; }
            1 | 2 | 4 => { let meso = self.fbm(u, v, 15, 15, 66); let micro = self.fbm(u, v, 52, 52, 71); s.color = color(s.color, self.secondary, meso * contrast * if self.preset == 1 { 0.035 } else { 0.09 }); s.height += (micro - 0.5) * if self.preset == 1 { 0.006 } else { 0.028 }; s.roughness += (meso - 0.5) * if self.preset == 1 { 0.025 } else { 0.07 }; }
            5 => { let aggregate = self.fbm(u, v, 42, 42, 101); let fine = self.fbm(u, v, 100, 100, 106); let stone = clamp((fine - 0.58) * 2.5); s.color = color(self.primary, self.secondary, (aggregate * 0.13 + stone * 0.32) * contrast); s.height = 0.5 + (aggregate - 0.5) * 0.05 + stone * 0.08; s.cavity = (1.0 - aggregate) * 0.12; s.roughness = (aggregate - 0.5) * 0.045; }
            _ => {}
        }
    }
}
fn joint_distance(fx: f64, fy: f64, width: f64, height: f64) -> f64 {
    let x = fx * width; let y = fy * height; let lower = height * 0.25; let upper = height * 0.75; let inset = width * 0.13;
    let mut squared = y.min(height - y).powi(2);
    for edge in [0.0, width] { for (left, bottom, right, top) in [(edge, 0.0, edge, lower), (edge, upper, edge, height), (edge - inset, lower, edge - inset, upper), (edge - inset, lower, edge, lower), (edge - inset, upper, edge, upper)] { let dx = x - left.max(right.min(x)); let dy = y - bottom.max(top.min(y)); squared = squared.min(dx * dx + dy * dy); } }
    squared.sqrt()
}
fn glass(seed: u32, u: f64, v: f64, tint: Color) -> Color {
    let cx = 0.46 + unit(seed, 0.0, 0.0, 80) * 0.08; let cy = 0.53; let hw = 0.2; let hh = 0.25;
    let left = cx - hw; let right = cx + hw; let bottom = cy - hh; let top = cy + hh; let dx = (u - cx) / hw; let dy = (v - cy) / hh;
    let rear = dx.abs() <= 1.0 && dy.abs() <= 1.0;
    let face = if rear { 0 } else if dx.abs() > dy.abs() { if dx < 0.0 { 1 } else { 2 } } else if dy < 0.0 { 4 } else { 3 };
    let warm = unit(seed, 1.0, 0.0, 81) * 13.0;
    let palette = [[65.0, 61.0, 54.0], [43.0, 42.0, 38.0], [54.0, 53.0, 48.0], [86.0, 84.0, 76.0], [35.0, 34.0, 31.0]];
    let mut c = palette[face].map(|channel| channel + warm);
    if rear { let edge = clamp((u - left).min(right - u).min(v - bottom).min(top - v) * 22.0); c = color([25.0, 27.0, 27.0], c, 0.55 + edge * 0.45); let sl = cx + 0.025; let sr = right - 0.035; if u > sl && u < sr && v > bottom + 0.035 && v < top - 0.09 { let rail = (((v - bottom) * 12.0) % 1.0 - 0.5).abs() > 0.4; c = if rail || u < sl + 0.014 || u > sr - 0.014 { [13.0, 17.0, 19.0] } else { [28.0 + warm, 31.0 + warm, 32.0 + warm] }; } if u > left + 0.035 && u < cx - 0.025 && v > cy + 0.04 && v < top - 0.035 { c = [32.0, 40.0, 43.0]; } }
    if face == 4 { let depth = (cy - v) / hh; let row = (1.0 / depth * 8.0 % 1.0 - 0.5).abs(); let column = ((u - cx) / depth * 16.0 % 1.0).abs(); if row > 0.46 || column < 0.035 { c = color(c, [12.0, 16.0, 18.0], 0.4); } }
    let desk = left + 0.015 + unit(seed, 2.0, 0.0, 82) * 0.025; let width = 0.18;
    if u > desk && u < desk + width && v > bottom - 0.018 && v < bottom + 0.055 { c = [15.0, 20.0, 22.0]; }
    if v > bottom - 0.12 && v < bottom && ((u > desk + 0.015 && u < desk + 0.03) || (u > desk + width - 0.03 && u < desk + width - 0.015)) { c = [12.0, 17.0, 19.0]; }
    color(c, tint, 0.08)
}

/// Four tightly packed RGBA maps: color, normal, roughness, ambient occlusion.
#[no_mangle]
pub unsafe extern "C" fn material_generate(config: *const f64, size: usize, preset: usize, seed: u32, output: *mut u8) -> i32 {
    if config.is_null() || output.is_null() || preset >= NAMES.len() || ![32, 64, 128, 256, 512, 1024].contains(&size) { return -1; }
    let c: [f64; 24] = std::slice::from_raw_parts(config, 24).try_into().unwrap();
    if c.iter().any(|n| !n.is_finite()) || c[8] <= 0.0 || c[9] <= 0.0 { return -1; }
    let seed = NAMES[preset].bytes().enumerate().fold(seed, |value, (index, ch)| hash(value, ch as u32, index as u32, 0));
    let mut context = Context { preset, seed, size, c, primary: [c[10], c[11], c[12]], secondary: [c[13], c[14], c[15]], accent: [c[16], c[17], c[18]], noise: Noise { seed, grids: HashMap::default() } };
    let count = size * size; let data = std::slice::from_raw_parts_mut(output, count * 16);
    let (map, rest) = data.split_at_mut(count * 4); let (normal, rest) = rest.split_at_mut(count * 4); let (rough, ao) = rest.split_at_mut(count * 4);
    let mut heights = vec![0.0; count]; let wear = c[0]; let vertical = [0, 1, 2, 7, 8, 9, 10, 12].contains(&preset);
    for y in 0..size { for x in 0..size {
        let index = y * size + x; let u = (x as f64 + 0.5) / size as f64; let v = (y as f64 + 0.5) / size as f64;
        let sample = context.sample(u, v);
        let streak = if wear != 0.0 { clamp((context.noise.sample(u, v, 48, 3, 41) - 0.5) * 2.3) } else { 0.0 };
        let stain = if wear != 0.0 { clamp((context.noise.sample(u, v, 5, 5, 42) - 0.34) * 1.3) } else { 0.0 };
        let edge = sample.edge.max(clamp(1.0 - u.min(v).min(1.0 - u).min(1.0 - v) * 18.0) * 0.3);
        let dirt = wear * clamp(streak * if vertical { 0.22 } else { 0.0 } + stain * 0.75 + edge * 0.35);
        let grain = context.noise.sample(u, v, 128, 128, 43);
        let brightness = (1.0 + (grain - 0.5) * 0.075 * c[2]) * (1.0 - dirt * 0.62);
        rgba(map, index, [sample.color[0] * brightness, sample.color[1] * brightness * (1.0 - dirt * 0.035), sample.color[2] * brightness * (1.0 - dirt * 0.085)]);
        rgba(rough, index, [clamp(c[3] + sample.roughness + dirt * 0.22) * 255.0; 3]);
        rgba(ao, index, [clamp(1.0 - sample.cavity * if preset == 4 { 0.24 } else { 0.48 } - dirt * 0.19) * 255.0; 3]);
        heights[index] = sample.height + dirt * 0.025 + (grain - 0.5) * wear * 0.02;
    } }
    let strength = c[4] * c[19] * size as f64 / 2.0;
    for y in 0..size { for x in 0..size {
        let dx = (heights[y * size + (x + 1) % size] - heights[y * size + (x + size - 1) % size]) * strength / c[8];
        let dy = (heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x]) * strength / c[9];
        let length = (dx * dx + dy * dy + 1.0).sqrt();
        rgba(normal, y * size + x, [(1.0 - dx / length) * 127.5, (1.0 - dy / length) * 127.5, (1.0 + 1.0 / length) * 127.5]);
    } }
    0
}
