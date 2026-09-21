import { nativeImage, type NativeImage } from 'electron';
import { VERIFICATION_AUTOMATION, type VerificationCheck } from '@vibisual/shared';
import { bitmapDifference, boundedImageSize, comparisonRegion } from './verificationAutomationPolicy';

export function normalizeVerificationImage(image: NativeImage): { png: Buffer; width: number; height: number } {
  if (image.isEmpty()) throw new Error('The target returned an empty screenshot.');
  const size = image.getSize();
  const bounded = boundedImageSize(size.width, size.height);
  const normalized = image.resize({ ...bounded, quality: 'best' });
  return { png: normalized.toPNG(), ...bounded };
}

export function compareVerificationImages(actualPng: Buffer, referencePng: Buffer, region?: Extract<VerificationCheck, { kind: 'screenshot' }>['region']): { passed: boolean; detail: string } {
  let actual = nativeImage.createFromBuffer(actualPng), expected = nativeImage.createFromBuffer(referencePng);
  if (actual.isEmpty() || expected.isEmpty()) throw new Error('A screenshot could not be decoded.');
  const a = actual.getSize(), b = expected.getSize();
  // Crop coordinates are fractions of each source. Never stretch a mismatched viewport into a pass.
  const cropA = comparisonRegion(a.width, a.height, region), cropB = comparisonRegion(b.width, b.height, region);
  const aspectTolerance = 0.03;
  if (Math.abs((cropA.width / cropA.height) / (cropB.width / cropB.height) - 1) > aspectTolerance) return { passed: false, detail: 'Screenshot aspect ratios differ; use the same target viewport or a matching comparison region.' };
  actual = actual.crop(cropA); expected = expected.crop(cropB);
  const size = boundedImageSize(Math.min(cropA.width, cropB.width), Math.min(cropA.height, cropB.height));
  const difference = bitmapDifference(actual.resize({ ...size, quality: 'best' }).toBitmap(), expected.resize({ ...size, quality: 'best' }).toBitmap());
  return { passed: difference <= VERIFICATION_AUTOMATION.screenshotMaxDifference, detail: `Normalized pixel difference ${(difference * 100).toFixed(2)}%; allowed ${(VERIFICATION_AUTOMATION.screenshotMaxDifference * 100).toFixed(2)}%.` };
}
