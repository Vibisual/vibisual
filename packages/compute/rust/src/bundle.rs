//! Greedy bundle packing. Candidate order and f64 predicates match the canvas reference.

#[derive(Clone, Copy)]
struct Body { r: f64, half: f64, x: f64, y: f64 }

#[derive(Clone, Copy)]
struct Config { cx: f64, cy: f64, gap: f64, aspect: f64, caption_gap: f64, caption_height: f64, epsilon: f64 }

fn caption_top(body: &Body, config: Config) -> f64 { body.y + body.r + config.caption_gap }

fn circle_hits_caption(circle: &Body, owner: &Body, config: Config) -> bool {
    if owner.half <= 0.0 { return false; }
    let top = caption_top(owner, config);
    let nx = (owner.x - owner.half).max(circle.x.min(owner.x + owner.half));
    let ny = top.max(circle.y.min(top + config.caption_height));
    let dx = circle.x - nx;
    let dy = circle.y - ny;
    let reach = circle.r + config.gap - config.epsilon;
    dx * dx + dy * dy < reach * reach
}

fn clash(a: &Body, b: &Body, config: Config) -> bool {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let rr = a.r + b.r + config.gap - config.epsilon;
    if dx * dx + dy * dy < rr * rr { return true; }
    if circle_hits_caption(a, b, config) || circle_hits_caption(b, a, config) { return true; }
    if a.half <= 0.0 || b.half <= 0.0 { return false; }
    let a_top = caption_top(a, config);
    let b_top = caption_top(b, config);
    let span = config.caption_height + config.gap - config.epsilon;
    (a.x - b.x).abs() < a.half + b.half + config.gap - config.epsilon
        && a_top < b_top + span && b_top < a_top + span
}

fn pack(input: &[f64], count: usize, directions: usize, output: &mut [f64]) {
    let config = Config { cx: input[0], cy: input[1], gap: input[2], aspect: input[3], caption_gap: input[4], caption_height: input[5], epsilon: input[6] };
    let trig = &input[7 + count * 2..];
    let mut placed: Vec<Body> = Vec::with_capacity(count);
    let drop = config.caption_gap + config.caption_height;
    let mut min_x = config.cx;
    let mut min_y = config.cy;
    for index in 0..count {
        let mut body = Body { r: input[7 + index * 2], half: input[8 + index * 2], x: config.cx, y: config.cy };
        if !placed.is_empty() {
            let mut best_x = 0.0;
            let mut best_y = 0.0;
            let mut best_score = f64::INFINITY;
            for neighbor in &placed {
                for distance in [neighbor.r + body.r + config.gap, neighbor.r + drop + body.r + config.gap] {
                    for direction in 0..directions {
                        let x = neighbor.x + trig[direction * 2] * distance;
                        let y = neighbor.y + trig[direction * 2 + 1] * distance;
                        let dx = (x - config.cx) / config.aspect;
                        let dy = y - config.cy;
                        let score = dx * dx + dy * dy;
                        if score >= best_score { continue; }
                        body.x = x;
                        body.y = y;
                        if placed.iter().any(|other| clash(&body, other, config)) { continue; }
                        best_x = x;
                        best_y = y;
                        best_score = score;
                    }
                }
            }
            if best_score == f64::INFINITY {
                best_x = config.cx;
                best_y = placed.iter().map(|other| caption_top(other, config) + config.caption_height)
                    .fold(f64::NEG_INFINITY, f64::max) + config.gap + body.r;
            }
            body.x = best_x;
            body.y = best_y;
        }
        output[index * 2] = body.x - body.r;
        output[index * 2 + 1] = body.y - body.r;
        min_x = min_x.min(body.x - body.r.max(body.half));
        min_y = min_y.min(body.y - body.r);
        placed.push(body);
    }
    output[count * 2] = min_x;
    output[count * 2 + 1] = min_y;
}

/// Input: config[7], ordered [radius, caption half-width], host sin/cos pairs.
/// Output: ordered top-left positions followed by the content's minimum x/y.
#[no_mangle]
pub unsafe extern "C" fn bundle_pack(input: *const f64, count: usize, directions: usize, output: *mut f64) -> u32 {
    if input.is_null() || output.is_null() || directions < 4 { return 1; }
    let Some(input_len) = count.checked_add(directions).and_then(|n| n.checked_mul(2)).and_then(|n| n.checked_add(7)) else { return 1; };
    let Some(output_len) = count.checked_mul(2).and_then(|n| n.checked_add(2)) else { return 1; };
    let input = unsafe { std::slice::from_raw_parts(input, input_len) };
    if input.iter().any(|value| !value.is_finite()) || input[3] <= 0.0 { return 2; }
    let output = unsafe { std::slice::from_raw_parts_mut(output, output_len) };
    pack(input, count, directions, output);
    0
}
