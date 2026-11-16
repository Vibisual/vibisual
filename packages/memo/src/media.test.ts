import { describe, expect, it } from 'vitest';
import { extensionMime, mediaExtension, mediaKind, mediaMime } from './media.js';

describe('attachment media types', () => {
  it('uses the name when the OS reports no type and the type when the name disagrees', () => {
    expect(mediaExtension('clip.MKV', '')).toBe('mkv'); expect(mediaKind('clip.MKV', '')).toBe('video'); expect(mediaMime('clip.MKV', '')).toBe('video/x-matroska');
    expect(mediaExtension('image.png', 'image/png')).toBe('png'); expect(mediaExtension('photo.jpeg', 'image/jpeg')).toBe('jpeg');
    expect(mediaExtension('photo', 'image/jpeg')).toBe('jpg'); expect(mediaExtension('notes.txt', 'image/png')).toBe('png');
    expect(mediaExtension('voice.m4a', 'audio/x-m4a')).toBe('m4a'); expect(mediaKind('song.opus', 'audio/ogg; codecs=opus')).toBe('audio');
  });
  it('treats unknown and unsafe names as inert files', () => {
    expect(mediaKind('page.html', 'text/html')).toBe('file'); expect(mediaExtension('page.html', 'text/html')).toBe('html'); expect(extensionMime('original.html')).toBe('application/octet-stream');
    expect(mediaExtension('archive', '')).toBe('bin'); expect(mediaExtension('weird.<script>', '')).toBe('bin'); expect(mediaExtension('a.very-long-extension', '')).toBe('bin');
    expect(mediaMime('data.bin', '')).toBe('application/octet-stream'); expect(extensionMime('thumb.webp')).toBe('image/webp');
  });
});
