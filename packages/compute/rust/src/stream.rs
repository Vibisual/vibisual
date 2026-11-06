//! Numeric transcript plans. Display objects and text remain in the host.

use std::cmp::Ordering;
use std::slice;

fn compare_entry(a: usize, b: usize, sort_ts: &[f64], timestamps: &[f64], ranks: &[i32]) -> Ordering {
    // Mirrors (a.sortTs - b.sortTs) || (a.rank - b.rank) || (a.ts - b.ts).
    // Equal infinities subtract to NaN in JS and therefore fall through too.
    for difference in [sort_ts[a] - sort_ts[b], f64::from(ranks[a]) - f64::from(ranks[b]), timestamps[a] - timestamps[b]] {
        if difference < 0.0 { return Ordering::Less; }
        if difference > 0.0 { return Ordering::Greater; }
    }
    Ordering::Equal
}

/// Stable indices, including command/stop boundaries and equal-time insertion order.
/// NaN keys use the host's legacy sort: its comparator is not a total ordering.
#[no_mangle]
pub unsafe extern "C" fn stream_order(sort_ts: *const f64, timestamps: *const f64, ranks: *const i32, count: usize, output: *mut u32) -> u32 {
    if count == 0 { return 0; }
    let sort_ts = slice::from_raw_parts(sort_ts, count);
    let timestamps = slice::from_raw_parts(timestamps, count);
    let ranks = slice::from_raw_parts(ranks, count);
    let output = slice::from_raw_parts_mut(output, count);
    if sort_ts.iter().chain(timestamps).any(|value| value.is_nan()) { return 0; }
    let mut indices: Vec<usize> = (0..count).collect();
    indices.sort_by(|&a, &b| compare_entry(a, b, sort_ts, timestamps, ranks));
    for (target, source) in output.iter_mut().zip(indices) { *target = source as u32; }
    count as u32
}

/// Exclusive ends: 1=text with the same label, 2=tool_use followed by 3=tool_result.
/// Other types are singletons. Tool result ownership matches the original adjacent-row rule.
#[no_mangle]
pub unsafe extern "C" fn stream_runs(types: *const u32, sessions: *const u32, count: usize, output: *mut u32) -> u32 {
    if count == 0 { return 0; }
    let types = slice::from_raw_parts(types, count);
    let sessions = slice::from_raw_parts(sessions, count);
    let output = slice::from_raw_parts_mut(output, count);
    for (i, end) in output.iter_mut().enumerate() { *end = (i + 1) as u32; }
    let mut i = 0;
    while i < count {
        let mut end = i + 1;
        if types[i] == 1 {
            while end < count && types[end] == 1 && sessions[end] == sessions[i] { end += 1; }
        } else if types[i] == 2 {
            while end < count && types[end] == 3 { end += 1; }
        }
        output[i] = end as u32;
        i = end;
    }
    count as u32
}

/// Batch upper-bound search, exactly matching turnOfEvent's timestamp comparisons.
/// Explicit turn IDs are retained by the host; u32::MAX denotes no matching anchor.
#[no_mangle]
pub unsafe extern "C" fn stream_turns(event_ts: *const f64, event_count: usize, anchor_ts: *const f64, anchor_count: usize, output: *mut u32) -> u32 {
    if event_count == 0 { return 0; }
    let events = slice::from_raw_parts(event_ts, event_count);
    let anchors = slice::from_raw_parts(anchor_ts, anchor_count);
    let output = slice::from_raw_parts_mut(output, event_count);
    for (event, target) in events.iter().zip(output) {
        let mut lo = 0;
        let mut hi = anchor_count;
        while lo < hi {
            let mid = (lo + hi) / 2;
            if anchors[mid] <= *event { lo = mid + 1; } else { hi = mid; }
        }
        *target = if lo == 0 { u32::MAX } else { (lo - 1) as u32 };
    }
    event_count as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_boundary_order_with_infinite_pending_times() {
        let times = [10.0, 10.0, f64::INFINITY, 10.0, 10.0, f64::INFINITY];
        let ranks = [0, 1, -1, -1, 0, -1];
        let mut out = [0; 6];
        unsafe { stream_order(times.as_ptr(), times.as_ptr(), ranks.as_ptr(), times.len(), out.as_mut_ptr()); }
        assert_eq!(out, [3, 0, 4, 1, 2, 5]);
    }

    #[test]
    fn runs_preserve_label_boundaries_and_orphan_results() {
        let types = [1, 1, 1, 3, 2, 3, 3, 2, 0, 1];
        let sessions = [0, 0, 1, 0, 0, 1, 0, 0, 0, 1];
        let mut out = [0; 10];
        unsafe { stream_runs(types.as_ptr(), sessions.as_ptr(), types.len(), out.as_mut_ptr()); }
        assert_eq!(out, [2, 2, 3, 4, 7, 6, 7, 8, 9, 10]);
    }

    #[test]
    fn turns_keep_last_equal_anchor_and_nan_comparison() {
        let events = [0.0, 10.0, 19.0, 20.0, f64::NAN, f64::INFINITY];
        let anchors = [10.0, 10.0, 20.0];
        let mut out = [0; 6];
        unsafe { stream_turns(events.as_ptr(), events.len(), anchors.as_ptr(), anchors.len(), out.as_mut_ptr()); }
        assert_eq!(out, [u32::MAX, 1, 1, 2, u32::MAX, 2]);
    }
}
