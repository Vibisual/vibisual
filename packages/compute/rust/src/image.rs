use std::slice;
use std::cell::RefCell;

#[derive(Default)]
struct KeyScratch { mark: Vec<u8>, queue: Vec<usize> }
thread_local! { static KEY_SCRATCH: RefCell<KeyScratch> = RefCell::new(KeyScratch::default()); }

// Preserve Uint8Array's truncation/modulo, including unusual caller colors.
fn byte(value: f64) -> u8 {
    if !value.is_finite() { return 0; }
    value.trunc().rem_euclid(256.0) as u8
}

#[no_mangle]
pub unsafe extern "C" fn image_distances(src: *const u8, count: usize, r: f64, g: f64, b: f64, out: *mut u8) -> u32 {
    let src = slice::from_raw_parts(src, count * 4);
    let out = slice::from_raw_parts_mut(out, count);
    if [r, g, b].iter().all(|v| v.is_finite() && *v >= 0.0 && *v <= 255.0 && v.fract() == 0.0) {
        let (r, g, b) = (r as u8, g as u8, b as u8);
        for (pixel, result) in src.chunks_exact(4).zip(out.iter_mut()) {
            *result = pixel[0].abs_diff(r).max(pixel[1].abs_diff(g)).max(pixel[2].abs_diff(b));
        }
        return 0;
    }
    for (pixel, result) in src.chunks_exact(4).zip(out.iter_mut()) {
        let dr = (pixel[0] as f64 - r).abs();
        let dg = (pixel[1] as f64 - g).abs();
        let db = (pixel[2] as f64 - b).abs();
        // Deliberately the former JS comparison order (NaN is not f64::max).
        *result = byte(if dr > dg { if dr > db { dr } else { db } } else if dg > db { dg } else { db });
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn image_color_key(src: *const u8, width: usize, height: usize, dist: *const u8,
    tol: f64, feather: f64, seeds: *const f64, seed_count: usize, contiguous: u32, out: *mut u8) -> u32 {
    let n = width * height;
    let src = slice::from_raw_parts(src, n * 4);
    let dist = slice::from_raw_parts(dist, n);
    let out = slice::from_raw_parts_mut(out, n * 4);
    out.copy_from_slice(src);
    if n == 0 { return 0; }
    KEY_SCRATCH.with(|scratch| {
    let mut scratch = scratch.borrow_mut();
    let KeyScratch { mark, queue } = &mut *scratch;
    mark.resize(n, 0); mark.fill(0); queue.clear();
    let passable = |p: usize| src[p * 4 + 3] == 0 || dist[p] as f64 <= tol;
    let in_band = |p: usize| src[p * 4 + 3] > 0 && dist[p] as f64 <= tol + feather;
    if contiguous != 0 {
        // Scanline flood fill visits the same four-connected component and its
        // one-pixel feather boundary, but queues runs instead of every pixel.
        // 3 = queued seed; queued runs can overlap and are skipped once filled.
        for seed in slice::from_raw_parts(seeds, seed_count * 2).chunks_exact(2) {
            let x = seed[0].floor(); let y = seed[1].floor();
            if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 || x >= width as f64 || y >= height as f64 { continue; }
            let p = y as usize * width + x as usize;
            if passable(p) {
                if mark[p] != 3 { mark[p] = 3; queue.push(p); }
            } else if in_band(p) { mark[p] = 2; }
        }
        while let Some(seed) = queue.pop() {
            if mark[seed] == 1 { continue; }
            let row = seed / width * width;
            let end = row + width;
            let mut left = seed;
            while left > row && mark[left - 1] != 1 && passable(left - 1) { left -= 1; }
            if left > row && mark[left - 1] == 0 && in_band(left - 1) { mark[left - 1] = 2; }
            let mut p = left;
            let mut span_above = false;
            let mut span_below = false;
            while p < end && mark[p] != 1 && passable(p) {
                mark[p] = 1;
                for (neighbor, span) in [
                    (if p >= width { Some(p - width) } else { None }, &mut span_above),
                    (if p + width < n { Some(p + width) } else { None }, &mut span_below),
                ] {
                    if let Some(q) = neighbor {
                        if mark[q] != 1 && passable(q) {
                            if !*span && mark[q] != 3 { mark[q] = 3; queue.push(q); }
                            *span = true;
                        } else {
                            *span = false;
                            if mark[q] == 0 && in_band(q) { mark[q] = 2; }
                        }
                    }
                }
                p += 1;
            }
            if p < end && mark[p] == 0 && in_band(p) { mark[p] = 2; }
        }
    } else {
        for p in 0..n { if passable(p) { mark[p] = 1; } }
        for p in 0..n {
            if mark[p] != 0 || !in_band(p) { continue; }
            let x = p % width;
            if (x > 0 && mark[p - 1] == 1) || (x + 1 < width && mark[p + 1] == 1)
                || (p >= width && mark[p - width] == 1) || (p + width < n && mark[p + width] == 1) { mark[p] = 2; }
        }
    }
    let mut changed = 0;
    for p in 0..n {
        let alpha = src[p * 4 + 3];
        if mark[p] == 0 || alpha == 0 { continue; }
        let next = if mark[p] == 1 { 0.0 } else { ((alpha as f64 * (dist[p] as f64 - tol)) / (feather + 1.0) + 0.5).floor() };
        if next < alpha as f64 { out[p * 4 + 3] = next.clamp(0.0, 255.0) as u8; changed += 1; }
    }
    changed
    })
}

#[no_mangle]
pub unsafe extern "C" fn image_flatten(src: *const u8, count: usize, r: f64, g: f64, b: f64, out: *mut u8) -> u32 {
    let src = slice::from_raw_parts(src, count * 4);
    let out = slice::from_raw_parts_mut(out, count * 4);
    out.copy_from_slice(src);
    for (pixel, result) in src.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
        if pixel[3] == 255 { continue; }
        let a = pixel[3] as f64 / 255.0;
        for (channel, background) in [r, g, b].iter().enumerate() {
            result[channel] = ((pixel[channel] as f64 * a + background * (1.0 - a)) + 0.5).floor().clamp(0.0, 255.0) as u8;
        }
        result[3] = 255;
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn image_has_transparency(src: *const u8, count: usize) -> u32 {
    slice::from_raw_parts(src, count * 4).chunks_exact(4).any(|pixel| pixel[3] < 255) as u32
}

#[no_mangle]
pub unsafe extern "C" fn image_trim(src: *const u8, width: usize, height: usize, r: f64, g: f64, b: f64,
    alpha: f64, transparent: u32, tolerance: f64, out: *mut f64) -> u32 {
    if width == 0 || height == 0 { return 0; }
    let src = slice::from_raw_parts(src, width * height * 4);
    let is_bg = |x: usize, y: usize| {
        let i = (y * width + x) * 4;
        if transparent != 0 { return src[i + 3] <= 8; }
        if (src[i + 3] as f64 - alpha).abs() > tolerance { return false; }
        (src[i] as f64 - r).abs() <= tolerance && (src[i + 1] as f64 - g).abs() <= tolerance && (src[i + 2] as f64 - b).abs() <= tolerance
    };
    let mut top = 0;
    while top < height && (0..width).all(|x| is_bg(x, top)) { top += 1; }
    if top == height { return 0; }
    let mut bottom = height - 1;
    while bottom > top && (0..width).all(|x| is_bg(x, bottom)) { bottom -= 1; }
    let mut left = 0;
    while left < width - 1 && (top..=bottom).all(|y| is_bg(left, y)) { left += 1; }
    let mut right = width - 1;
    while right > left && (top..=bottom).all(|y| is_bg(right, y)) { right -= 1; }
    slice::from_raw_parts_mut(out, 4).copy_from_slice(&[left as f64, top as f64, (right - left + 1) as f64, (bottom - top + 1) as f64]);
    1
}
