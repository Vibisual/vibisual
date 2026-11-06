//! Canvas satellite return-path checks. The final distance predicates match the
//! former JavaScript loop; a grid only removes bodies that cannot reach a parent.

use std::collections::HashMap;

const STRIDE: usize = 6;

fn js_distance(x: f64, y: f64, zero: f64) -> f64 {
    let distance = (x * x + y * y).sqrt();
    if distance == 0.0 || distance.is_nan() { zero } else { distance }
}

fn parent_of(body: &[f64], count: usize) -> Option<usize> {
    let parent = body[4];
    if parent < 0.0 || parent >= count as f64 || !parent.is_finite() || parent.fract() != 0.0 {
        None
    } else {
        Some(parent as usize)
    }
}

fn cell(body: &[f64], size: f64) -> (i64, i64) {
    ((body[0] / size).floor() as i64, (body[1] / size).floor() as i64)
}

fn blocks(satellite: &[f64], parent: &[f64], other: &[f64], distance_to_parent: f64, gap: f64) -> bool {
    let parent_distance = js_distance(other[0] - parent[0], other[1] - parent[1], 0.1);
    let parent_minimum = parent[2] + other[3] + gap;
    if parent_distance > parent_minimum + 1.0 || parent_distance >= distance_to_parent {
        return false;
    }
    let satellite_distance = js_distance(other[0] - satellite[0], other[1] - satellite[1], 0.1);
    satellite_distance <= satellite[2] + other[3] + gap + 6.0
}

pub fn frozen_satellite_flags(input: &[f64], gap: f64) -> Vec<u8> {
    let count = input.len() / STRIDE;
    let bodies: Vec<&[f64]> = input.chunks_exact(STRIDE).collect();
    let mut frozen = vec![0; count];
    let mut maximum_extent: f64 = 0.0;
    let mut maximum_radius: f64 = 0.0;
    let mut finite_geometry = gap.is_finite();
    for body in &bodies {
        finite_geometry &= body[..4].iter().all(|value| value.is_finite());
        maximum_radius = maximum_radius.max(body[2]);
        maximum_extent = maximum_extent.max(body[3]);
    }
    // Every possible blocker is within this distance of its satellite's parent.
    // A small broad-phase margin covers division rounding at cell boundaries;
    // it never changes the final distance predicates.
    let cell_size = (maximum_radius + maximum_extent + gap + 1.0).max(1.0)
        * (1.0 + 8.0 * f64::EPSILON);
    let use_grid = finite_geometry && cell_size.is_finite();
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    if use_grid {
        for (index, body) in bodies.iter().enumerate() {
            grid.entry(cell(body, cell_size)).or_default().push(index);
        }
    }
    // Siblings share their parent's neighborhood. No positions change during
    // this check, so the candidate list remains valid for the complete step.
    let mut candidates: HashMap<usize, Vec<usize>> = HashMap::new();
    for (satellite_index, satellite) in bodies.iter().enumerate() {
        if satellite[5] != 0.0 { continue; }
        let Some(parent_index) = parent_of(satellite, count) else { continue; };
        let parent = bodies[parent_index];
        let distance_to_parent = js_distance(satellite[0] - parent[0], satellite[1] - parent[1], 1.0);
        let near = candidates.entry(parent_index).or_insert_with(|| {
            if !use_grid { return (0..count).collect(); }
            let (cx, cy) = cell(parent, cell_size);
            let mut near = Vec::new();
            for dx in -1i64..=1 {
                for dy in -1i64..=1 {
                    let (Some(x), Some(y)) = (cx.checked_add(dx), cy.checked_add(dy)) else { continue; };
                    if let Some(bucket) = grid.get(&(x, y)) { near.extend_from_slice(bucket); }
                }
            }
            near
        });
        for &other_index in near.iter() {
            if other_index == satellite_index || other_index == parent_index { continue; }
            if blocks(satellite, parent, bodies[other_index], distance_to_parent, gap) {
                frozen[satellite_index] = 1;
                break;
            }
        }
    }
    frozen
}

/// Input: six f64 per body [x, y, radius, extent, parent index (-1 = none), dragging].
/// Output: one byte per body (1 = frozen). The host owns both allocated buffers.
#[no_mangle]
pub unsafe extern "C" fn physics_frozen_satellites(input: *const f64, count: usize, gap: f64, output: *mut u8) -> u32 {
    if count == 0 { return 0; }
    let Some(length) = count.checked_mul(STRIDE) else { return 1; };
    if input.is_null() || output.is_null() { return 1; }
    let input = unsafe { std::slice::from_raw_parts(input, length) };
    let flags = frozen_satellite_flags(input, gap);
    unsafe { std::ptr::copy_nonoverlapping(flags.as_ptr(), output, count); }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_satellite_and_dragging_preserve_the_distance_predicate() {
        let mut input = vec![
            0.0, 0.0, 20.0, 20.0, -1.0, 0.0,
            70.0, 0.0, 20.0, 20.0, 0.0, 0.0,
            50.0, 0.0, 20.0, 20.0, -1.0, 0.0,
        ];
        assert_eq!(frozen_satellite_flags(&input, 12.0), [0, 1, 0]);
        input[11] = 1.0;
        assert_eq!(frozen_satellite_flags(&input, 12.0), [0, 0, 0]);
    }
}
