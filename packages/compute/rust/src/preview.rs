use std::{cmp::Ordering, slice};

/// Recent files first; UTF-16 path order matches JavaScript's lexical comparison.
#[no_mangle]
pub unsafe extern "C" fn preview_order(times: *const f64, offsets: *const u32, names: *const u16, count: usize, output: *mut u32) -> u32 {
    if count == 0 { return 0; }
    let times = slice::from_raw_parts(times, count);
    let offsets = slice::from_raw_parts(offsets, count + 1);
    let names = slice::from_raw_parts(names, offsets[count] as usize);
    if offsets.windows(2).any(|pair| pair[0] > pair[1]) || times.iter().any(|time| !time.is_finite()) { return 0; }
    let mut indices: Vec<usize> = (0..count).collect();
    indices.sort_by(|&a, &b| {
        times[b].partial_cmp(&times[a]).unwrap_or(Ordering::Equal).then_with(|| {
            names[offsets[a] as usize..offsets[a + 1] as usize]
                .cmp(&names[offsets[b] as usize..offsets[b + 1] as usize])
        })
    });
    for (target, source) in slice::from_raw_parts_mut(output, count).iter_mut().zip(indices) { *target = source as u32; }
    count as u32
}
