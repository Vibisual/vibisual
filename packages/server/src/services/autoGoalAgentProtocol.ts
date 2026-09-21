import { issueAutoGoalCapability } from './autoGoalActorAuth.js';

/** Uses the current working agent for review; never spawns a separate model call. */
export function buildAutoGoalAgentProtocol(ids: { root: string; agentId: string; subAgentId: string; identityFile?: string }): string {
  const identity = JSON.stringify({ agentId: ids.agentId, subAgentId: ids.subAgentId,
    procedureToken: issueAutoGoalCapability(ids.root, ids) });
  return [
    '## 절차 검토·재사용 규약',
    '이 목록은 과거 관찰입니다. 지금 사용자 요청과 현재 코드가 우선이며, 목록의 제목만 보고 이미 끝난 기능을 다시 구현하지 마세요.',
    '지금 작업과 관련 있는 절차만 읽으세요. 검토 대기 절차는 실행 지침이 아닙니다. 현재 파일·테스트·사용자 의도와 대조한 뒤 승인하거나 고쳐 승인하고, 잘못됐거나 불필요한 절차는 이유를 남겨 사용 중지/대체하세요.',
    '별도 검토 에이전트를 반복 생성하지 말고 현재 작업 중에 확인한 근거를 사용하세요. 관련 없는 후보 검토를 위해 작업을 늘리지 마세요.',
    `아래 POST 요청의 공통 JSON 필드: ${identity}`,
    '주소는 환경변수 VIBISUAL_BASE, 인증 헤더는 x-vibisual-hook-token: VIBISUAL_TOKEN 또는 VIBISUAL_HOOK_AUTH 입니다. 토큰을 출력하지 마세요. 환경이 없거나 요청이 실패하면 재사용이 검증됐다고 주장하거나 작업을 생략하지 마세요.',
    ...(ids.identityFile ? [`환경변수가 없는 연결 세션은 ${JSON.stringify(ids.identityFile)}의 port/token을 요청 스크립트 메모리에서만 읽어 http://127.0.0.1:<port>와 인증 헤더를 구성할 수 있습니다. 파일 내용이나 토큰을 도구 출력·본문에 표시하지 마세요.`] : []),
    '- POST /api/auto-goal/context: 공통 필드만 보내 현재 id·revision·path·status를 받습니다. revision 충돌(409)이면 새 내용을 읽고 다시 판단하세요.',
    '- POST /api/auto-goal/review: 공통 필드 + {skillId,revision,decision,reason,applicability,files}. decision은 approve/revise/retire/supersede 입니다. approve/revise는 현재 적용 조건(applicability), 검토 근거(reason), 실제로 읽고 확인한 프로젝트 상대 파일(files)을 포함하세요. revise는 개선한 전체 마크다운 본문(body), supersede는 검토 통과한 대체 절차 id(supersededBy)를 보냅니다. 파일이 존재한다는 이유만으로 올바르다고 승인하지 마세요.',
    '- POST /api/auto-goal/assess: 공통 필드 + {skillId,taskKey,inputFiles}. taskKey는 같은 요청·옵션·범위를 나타내는 안정적인 키입니다. inputFiles에는 결과에 영향을 주는 모든 소스·설정·의존성 잠금 파일을 적으세요. 누락된 의존성이나 외부 상태가 있으면 완료 결과 생략을 적용하지 마세요.',
    '- assessment.decision=review이면 현재 절차를 검토해야 하고, blocked이면 사용하지 않습니다. run이면 현재 요청에 필요한 작업을 수행합니다. skip이면 동일한 입력과 완료 결과가 유지됨을 서버가 확인한 것입니다. 현재 요청이 강제 재실행/재검증이거나 외부 상태에 의존하면 생략하지 말고 새 taskKey로 assess 하세요.',
    '- POST /api/auto-goal/outcome: 공통 필드 + {skillId,assessmentId,outcome,evidence,outputFiles}. assessmentId는 assess의 응답입니다. run 후 성공은 completed 또는 reused, 실패는 failed, skip 후 실제 재작업을 생략했다면 skipped를 보냅니다. 성공에는 실제 검증한 산출물 outputFiles와 수행한 검증 evidence를 남기세요. 파일이나 성공 결과를 지어내지 마세요. skip 없이 skipped를 신고하지 마세요.',
    '사용 중 절차가 틀렸다면 수정안을 검토해 revise로 남기세요. 실패나 관련 파일 변경으로 재검토 상태가 된 것은 재승인 전까지 재사용하지 않습니다. 무효한 옛 절차를 같은 내용으로 새 후보로 다시 만들지 마세요.',
    '이 창구는 절차 상태를 실제로 바꾸는 전용 API입니다. 표시 전용 작업/검수 카드로 대신 신고하지 마세요.',
  ].join('\n');
}
