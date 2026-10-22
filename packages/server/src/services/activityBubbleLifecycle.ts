import type { BubbleData } from '@vibisual/shared';

/**
 * Generated activity bubbles share acknowledgment, idle expiry and edge cleanup.
 * Command apps extend the normal bubble lifecycle; the persistent Bash satellite
 * has no commandApp metadata and continues to follow its agent instead.
 */
export function followsActivityBubbleLifecycle(node: Pick<BubbleData, 'bubbleType' | 'commandApp'>): boolean {
  return node.bubbleType === 'file'
    || node.bubbleType === 'internal_folder'
    || node.bubbleType === 'external_folder'
    || node.bubbleType === 'domain'
    || (node.bubbleType === 'bash' && !!node.commandApp);
}
