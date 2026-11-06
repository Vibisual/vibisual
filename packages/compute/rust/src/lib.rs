use std::alloc::{alloc_zeroed, dealloc, Layout};

mod physics;
mod stream;
mod preview;
mod bundle;
mod image;
mod video;
mod material;
mod surface_wear;

#[no_mangle]
pub extern "C" fn compute_api_version() -> u32 { 1 }

// Every input/output buffer can be viewed as f64; the host must free the exact byte length.
#[no_mangle]
pub extern "C" fn compute_alloc(bytes: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) else { return std::ptr::null_mut(); };
    unsafe { alloc_zeroed(layout) }
}

#[no_mangle]
pub unsafe extern "C" fn compute_dealloc(ptr: *mut u8, bytes: usize) {
    if !ptr.is_null() {
        if let Ok(layout) = Layout::from_size_align(bytes.max(1), 8) { dealloc(ptr, layout); }
    }
}
