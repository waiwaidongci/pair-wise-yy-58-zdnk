// 吊车档案、起重性能表与替换校核计算引擎
// 替换校核的核心：吊重由原方案固定（实际吊重不变），换车后按新车性能表重新求荷载率，
// 并按新车支腿反力反算对地耐力，与现场地基承载力比较。

export type PerformancePoint = { radius: number; capacity: number };

export type CraneArchive = {
  id: string;
  code: string;
  model: string;
  name: string;
  manufacturer: string;
  selfWeightT: number;            // 自重 / t
  performance: PerformancePoint[]; // 起重性能表（额定起重量 / t）
  outriggerBaseReactionKn: number; // 空载单腿反力 / kN
  outriggerPerLoadKnPerT: number;  // 每吊起 1t 荷载的单腿反力增量 / kN
  maxOutriggerReactionKn: number;  // 单腿结构允许最大反力 / kN
};

export type Foundation = {
  site: string;
  bearingCapacityKpa: number; // 地基承载力特征值 / kPa
  plateAreaM2: number;        // 支腿垫板面积 / m²
  plateLabel: string;
};

export type SignRole = 'equipment' | 'scheme' | 'safety' | 'general';

export const SIGN_ROLES: { role: SignRole; label: string; defaultName: string }[] = [
  { role: 'equipment', label: '设备管理', defaultName: '刘明' },
  { role: 'scheme', label: '方案工程', defaultName: '赵磊' },
  { role: 'safety', label: '安全监督', defaultName: '周工' },
  { role: 'general', label: '总包项目部', defaultName: '陈晓' }
];

export const initialCranes: CraneArchive[] = [
  {
    id: 'crane-01',
    code: 'CR-01',
    model: '徐工 QY80K',
    name: '80t 汽车吊（原方案主吊）',
    manufacturer: '徐工',
    selfWeightT: 46,
    performance: [
      { radius: 6, capacity: 46 },
      { radius: 8, capacity: 37 },
      { radius: 10, capacity: 29 },
      { radius: 12, capacity: 23 },
      { radius: 14, capacity: 18.5 },
      { radius: 16, capacity: 15 },
      { radius: 18, capacity: 12.5 },
      { radius: 20, capacity: 10.2 },
      { radius: 22, capacity: 8.5 },
      { radius: 24, capacity: 7.2 },
      { radius: 26, capacity: 6 },
      { radius: 28, capacity: 5 }
    ],
    outriggerBaseReactionKn: 300,
    outriggerPerLoadKnPerT: 9.8,
    maxOutriggerReactionKn: 620
  },
  {
    id: 'crane-02',
    code: 'CR-02',
    model: '徐工 QY130K',
    name: '130t 汽车吊（候选）',
    manufacturer: '徐工',
    selfWeightT: 55,
    performance: [
      { radius: 8, capacity: 55 },
      { radius: 10, capacity: 44 },
      { radius: 12, capacity: 35 },
      { radius: 14, capacity: 28 },
      { radius: 16, capacity: 23 },
      { radius: 18, capacity: 19 },
      { radius: 20, capacity: 15.5 },
      { radius: 22, capacity: 13 },
      { radius: 24, capacity: 11 },
      { radius: 26, capacity: 9.2 },
      { radius: 28, capacity: 7.8 },
      { radius: 30, capacity: 6.6 }
    ],
    outriggerBaseReactionKn: 420,
    outriggerPerLoadKnPerT: 9.8,
    maxOutriggerReactionKn: 780
  },
  {
    id: 'crane-03',
    code: 'CR-03',
    model: '中联 ZTC500',
    name: '50t 汽车吊（候选）',
    manufacturer: '中联',
    selfWeightT: 30,
    performance: [
      { radius: 3, capacity: 25 },
      { radius: 6, capacity: 16 },
      { radius: 10, capacity: 9.5 },
      { radius: 14, capacity: 6.5 },
      { radius: 18, capacity: 4.8 },
      { radius: 22, capacity: 3.6 },
      { radius: 26, capacity: 2.8 },
      { radius: 30, capacity: 2.2 }
    ],
    outriggerBaseReactionKn: 200,
    outriggerPerLoadKnPerT: 9.8,
    maxOutriggerReactionKn: 420
  },
  {
    id: 'crane-04',
    code: 'CR-04',
    model: '三一 STC800',
    name: '80t 汽车吊（候选）',
    manufacturer: '三一',
    selfWeightT: 44,
    performance: [
      { radius: 6, capacity: 45 },
      { radius: 8, capacity: 36 },
      { radius: 10, capacity: 28.5 },
      { radius: 12, capacity: 22.5 },
      { radius: 14, capacity: 18 },
      { radius: 16, capacity: 14.5 },
      { radius: 18, capacity: 12 },
      { radius: 20, capacity: 9.8 },
      { radius: 22, capacity: 8.2 },
      { radius: 24, capacity: 7 },
      { radius: 26, capacity: 5.8 },
      { radius: 28, capacity: 4.6 }
    ],
    outriggerBaseReactionKn: 290,
    outriggerPerLoadKnPerT: 9.8,
    maxOutriggerReactionKn: 600
  }
];

export const initialFoundation: Foundation = {
  site: '东塔转换桁架吊装 · 主吊站位区',
  bearingCapacityKpa: 130,
  plateAreaM2: 3.6,
  plateLabel: '1.9m × 1.9m 路基板'
};

// 起重性能表查表：线性内插；超出表范围返回 null
export function ratedCapacityAt(crane: CraneArchive, radius: number): number | null {
  const table = crane.performance;
  if (table.length === 0) return null;
  if (radius < table[0].radius) return table[0].capacity;
  const last = table[table.length - 1];
  if (radius > last.radius) return null;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (radius >= a.radius && radius <= b.radius) {
      const t = (radius - a.radius) / (b.radius - a.radius);
      return +(a.capacity + t * (b.capacity - a.capacity)).toFixed(2);
    }
  }
  return null;
}

export type StepEval = {
  ratedCapacityT: number | null;
  actualLoadT: number | null;
  newLoadRate: number | null;
  outriggerReactionKn: number | null;
  groundPressureKpa: number | null;
  passed: boolean;
  issues: string[];
  role: SignRole;
};

// 按步骤作业半径 + 荷载率逐项查起重性能表，并校核支腿反力 / 地基承载力
export function evaluateStep(
  step: { loadRate: number; radius: number },
  current: CraneArchive,
  target: CraneArchive,
  foundation: Foundation
): StepEval {
  const issues: string[] = [];
  let role: SignRole = 'scheme';

  const ratedCurrent = ratedCapacityAt(current, step.radius);
  const ratedTarget = ratedCapacityAt(target, step.radius);

  let actualLoadT: number | null = null;
  let newLoadRate: number | null = null;
  let reaction: number | null = null;
  let pressure: number | null = null;

  if (ratedCurrent == null) {
    issues.push(`原吊车 ${current.model} 性能表无 ${step.radius}m 半径，无法推算实际吊重`);
  } else {
    // 实际吊重由原方案固定，换车不改变吊重
    actualLoadT = +((step.loadRate / 100) * ratedCurrent).toFixed(2);
  }

  if (ratedTarget == null) {
    issues.push(`替换吊车 ${target.model} 起重性能表不含 ${step.radius}m 作业半径`);
    role = 'equipment';
  } else if (actualLoadT != null) {
    newLoadRate = +((actualLoadT / ratedTarget) * 100).toFixed(1);
    if (newLoadRate > 100) {
      issues.push(`换车后荷载率 ${newLoadRate}% 超过额定起重量 ${ratedTarget}t`);
      role = 'scheme';
    }
  }

  if (actualLoadT != null) {
    reaction = +(target.outriggerBaseReactionKn + actualLoadT * target.outriggerPerLoadKnPerT).toFixed(1);
    pressure = +(reaction / foundation.plateAreaM2).toFixed(1);
    if (pressure > foundation.bearingCapacityKpa) {
      issues.push(`支腿对地耐力 ${pressure}kPa 超过地基承载力 ${foundation.bearingCapacityKpa}kPa`);
      role = 'equipment';
    }
  }

  return {
    ratedCapacityT: ratedTarget,
    actualLoadT,
    newLoadRate,
    outriggerReactionKn: reaction,
    groundPressureKpa: pressure,
    passed: issues.length === 0,
    issues,
    role
  };
}
