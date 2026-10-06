// 临时换主吊：吊车档案 / 起重性能表 / 逐步骤替换校核 的纯领域逻辑
// 不依赖 Pinia / Vue，便于单测与被 store 复用。

export type ChartPoint = {
  radius: number; // 作业半径 m
  capacity: number; // 该半径额定起重量 t
  reaction: number; // 该半径额定工况单腿最大反力 kN
};

export type CraneArchive = {
  id: string;
  model: string;
  maker: string;
  ratedTon: number; // 铭牌额定起重量 t
  counterweight: number; // 配重 t
  padLength: number; // 支腿路基板长 m
  padWidth: number; // 支腿路基板宽 m
  chartVersion: string; // 起重性能表版本
  updatedAt: string;
  chart: ChartPoint[]; // 按 radius 升序
};

export type DeviceSnapshot = {
  craneId: string;
  craneModel: string;
  chartVersion: string;
  ratedCapacity: number;
  ratedReaction: number;
  padLength: number;
  padWidth: number;
  groundCapacity: number;
  capturedAt: string;
  stale?: boolean;
  // 旧步骤升级前备份的原值
  backup?: {
    craneModel: string;
    loadRate: number;
    radius: number;
    boom: number;
    reason: string;
    backedAt: string;
  };
};

export type StepParams = {
  id: string;
  title: string;
  radius: number;
  boom: number;
  loadWeight: number; // 该步骤实际吊重 t（含吊索具）
  groundCapacity: number; // 站位处地基承载力特征值 kPa
  snapshot?: DeviceSnapshot;
};

export type StepCheck = {
  stepId: string;
  title: string;
  radius: number;
  requiredLoad: number;
  ratedCapacity: number | null;
  loadRate: number | null;
  ratedReaction: number | null;
  reaction: number | null;
  pressure: number | null;
  groundCapacity: number;
  padArea: number;
  beyondChart: boolean;
  pass: boolean;
  groundFail: boolean;
  reasons: string[];
  impacted: boolean;
  oldRate: number | null;
};

export type DiffItem = {
  field: string;
  from: string | number;
  to: string | number;
};

export type ChangeKind =
  | 'crane-chart'
  | 'crane-pad'
  | 'step-radius'
  | 'step-boom'
  | 'step-load'
  | 'step-ground'
  | 'step-wind'
  | 'replacement';

// 变更类型 → 需要立即失效重签的角色
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  'crane-chart': '吊车性能表 / 配重参数变更',
  'crane-pad': '支腿路基板尺寸变更',
  'step-radius': '步骤作业半径变更',
  'step-boom': '步骤臂长 / 幅度参数变更',
  'step-load': '步骤吊重 / 荷载变更',
  'step-ground': '站位地基承载力变更',
  'step-wind': '风速控制条件变更',
  replacement: '主吊替换'
};

export function rolesForChange(kind: ChangeKind): string[] {
  switch (kind) {
    case 'crane-chart':
      return ['设备', '方案'];
    case 'crane-pad':
      return ['设备', '安全'];
    case 'step-radius':
    case 'step-boom':
      return ['方案', '安全'];
    case 'step-load':
      return ['方案', '设备'];
    case 'step-ground':
      return ['设备', '安全', '总包'];
    case 'step-wind':
      return ['安全'];
    case 'replacement':
      return ['总包', '设备', '安全', '方案'];
  }
}

export const SIGN_ROLES: { role: string; person: string; scope: string }[] = [
  { role: '总包', person: '陈晓', scope: '吊装工序与场地移交' },
  { role: '设备', person: '刘明', scope: '吊车档案、性能表与支腿地基' },
  { role: '安全', person: '周工', scope: '净空、风速与警戒区' },
  { role: '方案', person: '赵磊', scope: '载荷计算与作业半径参数' }
];

// 线性查起重性能表；超过最大幅度视为表外（取不到额定值）
export function lookupChart(
  chart: ChartPoint[],
  radius: number
): { capacity: number | null; reaction: number | null; beyond: boolean } {
  const sorted = [...chart].sort((a, b) => a.radius - b.radius);
  if (radius > sorted[sorted.length - 1].radius) {
    return { capacity: null, reaction: null, beyond: true };
  }
  if (radius <= sorted[0].radius) {
    return { capacity: sorted[0].capacity, reaction: sorted[0].reaction, beyond: false };
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (radius >= a.radius && radius <= b.radius) {
      const t = (radius - a.radius) / (b.radius - a.radius);
      return {
        capacity: a.capacity + (b.capacity - a.capacity) * t,
        reaction: a.reaction + (b.reaction - a.reaction) * t,
        beyond: false
      };
    }
  }
  return { capacity: null, reaction: null, beyond: true };
}

// 单步骤替换校核：查性能表 → 荷载率 → 支腿反力 → 接地压力 vs 地基承载力
export function evaluateStep(crane: CraneArchive, step: StepParams): StepCheck {
  const found = lookupChart(crane.chart, step.radius);
  const padArea = crane.padLength * crane.padWidth;
  const reasons: string[] = [];
  let pass = true;
  let groundFail = false;

  let rate: number | null = null;
  let reaction: number | null = null;
  let pressure: number | null = null;

  if (found.beyond || found.capacity === null || found.reaction === null) {
    pass = false;
    reasons.push(`作业半径 ${step.radius}m 超出 ${crane.model} 性能表最大幅度，查不到额定起重量`);
  } else {
    rate = (step.loadWeight / found.capacity) * 100;
    if (rate > 100) {
      pass = false;
      reasons.push(`荷载率 ${rate.toFixed(1)}% 超过额定能力（需 ${step.loadWeight}t / 额定 ${found.capacity.toFixed(1)}t）`);
    } else if (rate > 90) {
      pass = false;
      reasons.push(`荷载率 ${rate.toFixed(1)}% 超过方案 90% 控制值`);
    }
    // 实际支腿反力按荷载比例折减（自重系数 0.55 + 荷载系数 0.45）
    const ratio = step.loadWeight / found.capacity;
    const factor = Math.min(1.25, 0.55 + 0.45 * ratio);
    reaction = found.reaction * factor;
    pressure = reaction / padArea;
    if (pressure > step.groundCapacity) {
      pass = false;
      groundFail = true;
      reasons.push(
        `支腿接地压力 ${pressure.toFixed(0)}kPa 超过地基承载力 ${step.groundCapacity}kPa（反力 ${reaction.toFixed(0)}kN / 路基板 ${padArea.toFixed(2)}㎡）`
      );
    }
  }

  const oldRate =
    step.snapshot && step.snapshot.ratedCapacity > 0
      ? (step.loadWeight / step.snapshot.ratedCapacity) * 100
      : null;
  const impacted =
    pass === false ||
    oldRate === null ||
    rate === null ||
    Math.abs(rate - oldRate) >= 0.5 ||
    (step.snapshot ? step.snapshot.craneId !== crane.id : true);

  return {
    stepId: step.id,
    title: step.title,
    radius: step.radius,
    requiredLoad: step.loadWeight,
    ratedCapacity: found.capacity,
    loadRate: rate,
    ratedReaction: found.reaction,
    reaction,
    pressure,
    groundCapacity: step.groundCapacity,
    padArea,
    beyondChart: found.beyond,
    pass,
    groundFail,
    reasons,
    impacted,
    oldRate
  };
}

export function runChecks(crane: CraneArchive, steps: StepParams[]): StepCheck[] {
  return steps.map((step) => evaluateStep(crane, step));
}

export function summarizeOutcome(results: StepCheck[]): {
  status: 'passed' | 'rejected';
  reason?: string;
  failed: StepCheck[];
  impacted: StepCheck[];
} {
  const failed = results.filter((item) => !item.pass);
  const impacted = results.filter((item) => item.impacted);
  const ground = failed.find((item) => item.groundFail);
  if (ground) {
    return {
      status: 'rejected',
      reason: `支腿反力导致接地压力超过地基承载力，替换被拒绝（首次触发：${ground.stepId} ${ground.title}）`,
      failed,
      impacted
    };
  }
  if (failed.length > 0) {
    return {
      status: 'rejected',
      reason: `${failed.length} 个步骤起重性能不满足（作业半径超表或荷载率超 90% 控制值），替换被拒绝`,
      failed,
      impacted
    };
  }
  return { status: 'passed', failed, impacted };
}

export function buildCraneDiff(from: CraneArchive, to: CraneArchive): DiffItem[] {
  return [
    { field: '吊车型号', from: from.model, to: to.model },
    { field: '额定起重量', from: `${from.ratedTon}t`, to: `${to.ratedTon}t` },
    { field: '配重', from: `${from.counterweight}t`, to: `${to.counterweight}t` },
    {
      field: '支腿路基板',
      from: `${from.padLength}×${from.padWidth}m`,
      to: `${to.padLength}×${to.padWidth}m`
    },
    { field: '性能表版本', from: from.chartVersion, to: to.chartVersion }
  ];
}

export function buildRetainedDiff(params: {
  priorApplicant: string;
  priorSubmittedAt: string;
  priorId: string;
  applicant: string;
  submittedAt: string;
  priorFailed: number;
  failed: number;
}): DiffItem[] {
  return [
    { field: '在先申请', from: params.priorId, to: '本申请保留' },
    { field: '申请人', from: params.priorApplicant, to: params.applicant },
    { field: '提交时间', from: params.priorSubmittedAt, to: params.submittedAt },
    { field: '同设备校核', from: `${params.priorFailed} 项不通过`, to: `${params.failed} 项不通过` },
    { field: '处理结论', from: '先到者生效', to: '后到者保留申请与差异，不占用生效名额' }
  ];
}

export function stepBasisSignature(crane: CraneArchive, step: StepParams): string {
  return [
    crane.id,
    crane.chartVersion,
    crane.padLength,
    crane.padWidth,
    step.radius,
    step.boom,
    step.loadWeight,
    step.groundCapacity
  ].join('|');
}

export function snapshotFor(
  crane: CraneArchive,
  step: StepParams,
  capturedAt: string
): DeviceSnapshot {
  const found = lookupChart(crane.chart, step.radius);
  return {
    craneId: crane.id,
    craneModel: crane.model,
    chartVersion: crane.chartVersion,
    ratedCapacity: found.capacity ?? 0,
    ratedReaction: found.reaction ?? 0,
    padLength: crane.padLength,
    padWidth: crane.padWidth,
    groundCapacity: step.groundCapacity,
    capturedAt
  };
}

export const CHECK_TEMPLATE: { key: string; label: string; hint: string }[] = [
  { key: 'freeze', label: '冻结方案版本与替换校核基准', hint: '冻结后基准留档，后续改动触发失效重算' },
  { key: 'archive', label: '吊车档案与起重性能表版本核验', hint: '型号、配重、支腿垫板、表版本逐项核对' },
  { key: 'radius', label: '按步骤作业半径与荷载率逐项查性能表', hint: '逐步骤插值取额定能力并核算荷载率' },
  { key: 'outrigger', label: '支腿反力与地基承载力比对', hint: '接地压力超过地基承载力即拒绝' },
  { key: 'impact', label: '受影响步骤与冲突清单确认', hint: '列出全部受影响步骤，其他步骤照旧' },
  { key: 'signoff', label: '对应角色会签 / 失效重签确认', hint: '关联角色完成签署后方可接受替换' }
];
