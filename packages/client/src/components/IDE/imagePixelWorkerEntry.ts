import { ImagePixelWorkerEngine, imagePixelTransfers } from './imagePixelWorkerEngine.js';
import type { ImagePixelMessage, ImagePixelReply } from './imagePixelWorkerProtocol.js';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImagePixelMessage>) => void) | null;
  postMessage(message: ImagePixelReply, transfer: Transferable[]): void;
};
const engine = new ImagePixelWorkerEngine();
scope.onmessage = ({ data }): void => {
  const reply = engine.run(data);
  scope.postMessage(reply, imagePixelTransfers(reply));
};
