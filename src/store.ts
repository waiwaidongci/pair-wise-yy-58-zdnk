import { defineStore } from 'pinia';
import { graphqlClient, LIFT_PLAN_QUERY } from './graphql';
import {
  buildCraneDiff,
  buildRetainedDiff,
  CHANGE_KIND_LABELS,
  ChangeKind,
  CHECK_TEMPLATE,
  CraneArchive,
  DeviceSnapshot,
  rolesForChange,
  runChecks,
  SIGN_ROLES,
  snapshotFor,
  StepCheck,
  stepBasisSignature,
  summarizeOutcome
} from './cranes';

export type StepStatus = 'pending' | 'passed' | 'blocked';

export type Comment = {
  id: string;
  author: string;
  role: string;
  content: string;
  status: 'open' | 'resolved';
  stepId: string;
};

export type LiftStep = {
  id: string;
  title: string;
  time: string;
  loadWeight: number; // 当前步骤吊重 t（含索具）
  loadRate: number; // 展示用荷载率 %，接受替换 / 参数变化时重算
  clearance: number;
  wind: number;
  radius: number;
  boom: number;
  groundCapacity: number; // 站位地基承载力 kPa
  status: StepStatus;
  note: string;
  snapshot?: DeviceSnapshot; // 该步骤已接受设备快照
};

export type Signoff = {
  id: string;
  requestId: string;
  role: string;
  person: string;
  stepId: string;
  state: 'pending' | 'signed' | 'invalid';
  basis: string;
  signedAt?: string;
  opinion?: string;
  invalidReason?: string;
};

export type ReplacementCheck = {
  key: string;
  label: string;
  hint: string;
  confirmed: boolean;
  confirmedAt?: string;
  confirmedBy?: string;
};

export type ReplacementRequest = {
  id: string;
  applicant: string;
  applicantTeam: string;
  submittedAt: string;
  fromCraneId: string;
  targetCraneId: string;
  status: 'active' | 'accepted' | 'rejected' | 'retained' | 'withdrawn';
  note: string;
  freeze: {
    revision: number;
    frozenAt: string;
    craneId: string;
    chartVersion: string;
    basis: Record<string, string>;
  };
  diff: ReturnType<typeof buildCraneDiff>;
  retained?: { priorRequestId: string; diff: ReturnType<typeof buildRetainedDiff> };
  duplicateOf?: string;
  checks: ReplacementCheck[];
  results: StepCheck[];
  outcome: { status: 'passed' | 'rejected'; reason?: string; failedIds: string[]; impactedIds: string[] };
  basisVersion: number;
  lastConfirmedKey?: string;
  basisEvents: { at: string; kind: ChangeKind; message: string }[];
  acceptedAt?: string;
  rejectedAt?: string;
  closedNote?: string;
};

const initialCranes: CraneArchive[] = [
  {
    id: 'CR-XCA260',
    model: '徐工 XCA260',
    maker: '徐工集团',
    ratedTon: 260,
    counterweight: 92,
    padLength: 2.4,
    padWidth: 2.4,
    chartVersion: 'XCA260-MAIN-V3.2',
    updatedAt: '2026-08-21 09:00',
    chart: [
      { radius: 18, capacity: 132, reaction: 430 },
      { radius: 20, capacity: 118, reaction: 455 },
      { radius: 22, capacity: 105, reaction: 480 },
      { radius: 24, capacity: 94, reaction: 505 },
      { radius: 27, capacity: 80, reaction: 548 }
    ]
  },
  {
    id: 'CR-XCA350',
    model: '徐工 XCA350',
    maker: '徐工集团',
    ratedTon: 350,
    counterweight: 118,
    padLength: 2.6,
    padWidth: 2.6,
    chartVersion: 'XCA350-MAIN-V2.1',
    updatedAt: '2026-09-02 14:30',
    chart: [
      { radius: 18, capacity: 168, reaction: 470 },
      { radius: 20, capacity: 150, reaction: 498 },
      { radius: 22, capacity: 134, reaction: 526 },
      { radius: 24, capacity: 120, reaction: 554 },
      { radius: 27, capacity: 103, reaction: 600 }
    ]
  },
  {
    id: 'CR-QY220K',
    model: '中联 QY220K',
    maker: '中联重科',
    ratedTon: 220,
    counterweight: 64,
    padLength: 1.6,
    padWidth: 1.6,
    chartVersion: 'QY220K-MAIN-V5.0',
    updatedAt: '2026-07-30 16:10',
    chart: [
      { radius: 18, capacity: 104, reaction: 452 },
      { radius: 20, capacity: 92, reaction: 480 },
      { radius: 22, capacity: 82, reaction: 510 },
      { radius: 24, capacity: 73, reaction: 540 },
      { radius: 27, capacity: 61, reaction: 590 }
    ]
  }
];

const initialSteps: LiftStep[] = [
  { id: 'S-01', title: '吊车支腿就位与地耐力复核', time: '07:30', loadWeight: 0, loadRate: 0, clearance: 4.2, wind: 3.4, radius: 18, boom: 42, groundCapacity: 180, status: 'passed', note: '支腿钢板 2.4m × 2.4m，已完成压实度复检。' },
  { id: 'S-02', title: '空钩回转与障碍物净空检查', time: '08:10', loadWeight: 8, loadRate: 8, clearance: 1.2, wind: 4.1, radius: 22, boom: 46, groundCapacity: 170, status: 'blocked', note: '东侧临时配电箱侵入回转半径 0.6m。' },
  { id: 'S-03', title: '桁架试吊离地 300mm', time: '08:45', loadWeight: 90, loadRate: 76, clearance: 2.8, wind: 5.2, radius: 20, boom: 44, groundCapacity: 180, status: 'pending', note: '需安全员确认吊点受力均匀。' },
  { id: 'S-04', title: '主吊回转至安装轴线', time: '09:20', loadWeight: 78, loadRate: 83, clearance: 1.8, wind: 6.8, radius: 24, boom: 48, groundCapacity: 190, status: 'pending', note: '风速超过 8m/s 立即停止。' },
  { id: 'S-05', title: '双机抬吊姿态调整', time: '10:05', loadWeight: 74, loadRate: 92, clearance: 1.3, wind: 7.2, radius: 27, boom: 52, groundCapacity: 150, status: 'blocked', note: '辅吊荷载率超过方案控制值。' },
  { id: 'S-06', title: '就位、临时固定与摘钩', time: '10:50', loadWeight: 64, loadRate: 68, clearance: 2.1, wind: 5.6, radius: 21, boom: 45, groundCapacity: 180, status: 'pending', note: '四组临时螺栓到位后方可摘钩。' }
];

const initialComments: Comment[] = [
  { id: 'C-11', author: '周工', role: '安全', content: 'S-02 回转路径与配电箱净空不足，请调整吊车站位或迁移配电箱。', status: 'open', stepId: 'S-02' },
  { id: 'C-12', author: '刘明', role: '设备', content: '辅吊支腿下方需要补充路基板，提供地耐力实测记录。', status: 'open', stepId: 'S-05' },
  { id: 'C-13', author: '陈晓', role: '总包', content: '同意主吊选型，建议把第三检查点前移到试吊阶段。', status: 'resolved', stepId: 'S-03' }
];

const cacheKey = 'yy58-lift-plan-draft-v2';
const legacyKey = 'yy58-lift-plan-draft';

type Persisted = {
  schemaVersion: number;
  cranes: CraneArchive[];
  currentCraneId: string;
  steps: LiftStep[];
  comments: Comment[];
  selectedStepId: string;
  revision: number;
  locked: boolean;
  viewBookmarks: string[];
  activeBookmark: string;
  replacements: ReplacementRequest[];
  signoffs: Signoff[];
  seq: number;
  resumeNotice?: string;
};

function now(): string {
  return new Date().toISOString();
}
function clockTime(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function migrateLegacySteps(stored: any[]): LiftStep[] {
  return initialSteps.map((base) => {
    const old = Array.isArray(stored) ? stored.find((item: LiftStep) => item.id === base.id) : undefined;
    return {
      ...base,
      ...(old
        ? {
            time: old.time ?? base.time,
            loadRate: typeof old.loadRate === 'number' ? old.loadRate : base.loadRate,
            clearance: old.clearance ?? base.clearance,
            wind: old.wind ?? base.wind,
            radius: old.radius ?? base.radius,
            boom: old.boom ?? base.boom,
            status: old.status ?? base.status,
            note: old.note ?? base.note
          }
        : {})
      // 不带设备快照：首次发起替换时走"先备份当前值再升级"路径
    };
  });
}

function freshState() {
  return {
    schemaVersion: 2 as number,
    cranes: initialCranes as CraneArchive[],
    currentCraneId: 'CR-XCA260',
    steps: initialSteps as LiftStep[],
    comments: initialComments as Comment[],
    selectedStepId: 'S-02',
    revision: 4,
    locked: false,
    viewBookmarks: ['主吊全景', '东侧障碍', '安装轴线'],
    activeBookmark: '主吊全景',
    replacements: [] as ReplacementRequest[],
    signoffs: [] as Signoff[],
    seq: 1,
    resumeNotice: '' as string
  };
}

function loadState(): ReturnType<typeof freshState> {
  const base = freshState();
  if (typeof localStorage === 'undefined') return base;
  const raw = localStorage.getItem(cacheKey);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Persisted;
      if (saved.schemaVersion === 2) {
        return { ...base, ...saved };
      }
    } catch {
      /* 损坏存档按初始状态处理 */
    }
  }
  // 旧版草稿：保留已编辑参数，但清掉快照触发备份升级
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    try {
      const old = JSON.parse(legacy);
      base.steps = migrateLegacySteps(old.steps);
      base.selectedStepId = old.selectedStepId ?? base.selectedStepId;
      base.revision = old.revision ?? base.revision;
      base.comments = old.comments ?? base.comments;
      base.locked = old.locked ?? base.locked;
    } catch {
      /* 忽略损坏旧档 */
    }
  }
  return base;
}

const loaded = loadState();

export const useLiftStore = defineStore('lift-plan', {
  state: () => ({ ...loaded }),
  getters: {
    selectedStep(state): LiftStep {
      return state.steps.find((step) => step.id === state.selectedStepId) ?? state.steps[0];
    },
    currentCrane(state): CraneArchive {
      return state.cranes.find((crane) => crane.id === state.currentCraneId) ?? state.cranes[0];
    },
    candidateCranes(state): CraneArchive[] {
      return state.cranes.filter((crane) => crane.id !== state.currentCraneId);
    },
    activeRequest(state): ReplacementRequest | undefined {
      return state.replacements.find((item) => item.status === 'active');
    },
    latestAccepted(state): ReplacementRequest | undefined {
      return [...state.replacements].reverse().find((item) => item.status === 'accepted');
    },
    retainedRequests(state): ReplacementRequest[] {
      return state.replacements.filter((item) => item.status === 'retained');
    },
    historyRequests(state): ReplacementRequest[] {
      return [...state.replacements]
        .filter((item) => item.status !== 'retained')
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    },
    resumeInfo(state): { requestId: string; nextLabel: string; done: number; total: number } | null {
      const active = state.replacements.find((item) => item.status === 'active');
      if (!active) return null;
      const done = active.checks.filter((item) => item.confirmed).length;
      const next = active.checks.find((item) => !item.confirmed);
      return {
        requestId: active.id,
        nextLabel: next ? next.label : '全部确认项已完成',
        done,
        total: active.checks.length
      };
    },
    requestSignoffs(state): (requestId: string) => Signoff[] {
      return (requestId: string) => state.signoffs.filter((item) => item.requestId === requestId);
    },
    openComments(state) {
      return state.comments.filter((comment) => comment.status === 'open');
    },
    conflicts(state) {
      const issues: { id: string; stepId: string; title: string; message: string; severity: 'high' | 'medium' }[] = [];
      state.steps.forEach((step) => {
        if (step.loadRate > 90) issues.push({ id: `${step.id}-rate`, stepId: step.id, title: step.title, message: `荷载率 ${step.loadRate}% 超过 90% 阈值`, severity: 'high' });
        if (step.clearance < 1.5) issues.push({ id: `${step.id}-clearance`, stepId: step.id, title: step.title, message: `净空 ${step.clearance}m 小于 1.5m`, severity: 'medium' });
        if (step.wind > 8) issues.push({ id: `${step.id}-wind`, stepId: step.id, title: step.title, message: `风速 ${step.wind}m/s 超过暂停值`, severity: 'medium' });
        if (step.radius > step.boom * 0.62) issues.push({ id: `${step.id}-radius`, stepId: step.id, title: step.title, message: '工作半径接近额定幅度', severity: 'medium' });
        if (step.snapshot?.stale) issues.push({ id: `${step.id}-stale`, stepId: step.id, title: step.title, message: '设备快照已过期：档案或步骤参数变更，需重新校核替换', severity: 'high' });
      });
      // 生效中的替换校核：失败步骤直接挂到冲突清单
      const active = state.replacements.find((item) => item.status === 'active');
      if (active) {
        active.results
          .filter((result) => !result.pass)
          .forEach((result) => {
            result.reasons.forEach((message, index) => {
              issues.push({
                id: `${active.id}-${result.stepId}-${index}`,
                stepId: result.stepId,
                title: result.title,
                message: `[换吊 ${active.id} → ${active.targetCraneId}] ${message}`,
                severity: result.groundFail ? 'high' : 'medium'
              });
            });
          });
      }
      return issues;
    },
    readiness(state): number {
      const passedChecks = state.steps.filter((step) => step.status === 'passed').length;
      const commentPenalty = state.comments.filter((item) => item.status === 'open').length * 12;
      let score = Math.round((passedChecks / state.steps.length) * 100 - commentPenalty);
      const active = state.replacements.find((item) => item.status === 'active');
      if (active) {
        const mine = state.signoffs.filter((item) => item.requestId === active.id);
        if (mine.length > 0) {
          const invalid = mine.filter((item) => item.state === 'invalid').length;
          const pending = mine.filter((item) => item.state === 'pending').length;
          score -= invalid * 6 + pending * 3;
        }
      }
      return Math.max(0, score);
    }
  },
  actions: {
    // ---------- 通用 ----------
    selectStep(id: string) {
      this.selectedStepId = id;
      this.persist();
    },
    setBookmark(name: string) {
      this.activeBookmark = name;
      if (!this.viewBookmarks.includes(name)) this.viewBookmarks.push(name);
      this.persist();
    },
    addComment(content: string, author = '王工', role = '方案') {
      if (!content.trim()) return;
      this.comments.unshift({ id: `C-${Date.now()}`, author, role, content, status: 'open', stepId: this.selectedStepId });
      this.persist();
    },
    resolveComment(id: string) {
      const item = this.comments.find((comment) => comment.id === id);
      if (item) item.status = 'resolved';
      this.persist();
    },
    setStatus(status: StepStatus) {
      this.updateStep({ status });
    },
    updateStep(patch: Partial<LiftStep>) {
      const index = this.steps.findIndex((step) => step.id === this.selectedStepId);
      if (index < 0) return;
      const before = this.steps[index];
      const after = { ...before, ...patch };
      // 参数一变：关联步骤、冲突与对应角色签署立即失效重算
      const kinds: ChangeKind[] = [];
      if (patch.radius !== undefined && patch.radius !== before.radius) kinds.push('step-radius');
      if (patch.boom !== undefined && patch.boom !== before.boom) kinds.push('step-boom');
      if (patch.loadWeight !== undefined && patch.loadWeight !== before.loadWeight) kinds.push('step-load');
      if (patch.groundCapacity !== undefined && patch.groundCapacity !== before.groundCapacity) kinds.push('step-ground');
      if (patch.wind !== undefined && patch.wind !== before.wind) kinds.push('step-wind');
      this.steps[index] = after;
      kinds.forEach((kind) => this.invalidateForChange(kind, [after.id], `步骤 ${after.id} 参数变更`));
      // 快照与现参数不一致即标记过期
      const snap = this.steps[index].snapshot;
      if (snap && kinds.some((kind) => kind !== 'step-wind')) {
        const fresh = snapshotFor(this.currentCrane, after, now());
        snap.stale =
          fresh.ratedCapacity !== snap.ratedCapacity ||
          fresh.padLength !== snap.padLength ||
          fresh.padWidth !== snap.padWidth ||
          snap.groundCapacity !== after.groundCapacity;
      }
      this.persist();
    },
    /** 旧版检查器滑杆：按当前吊车把荷载率换算回吊重，并触发重算 */
    setStepLoadRate(rate: number) {
      const step = this.steps.find((item) => item.id === this.selectedStepId);
      if (!step) return;
      const temp = snapshotFor(this.currentCrane, step, now());
      if (temp.ratedCapacity > 0) {
        this.updateStep({ loadWeight: +(rate * temp.ratedCapacity).toFixed(1) / 100 });
      } else {
        step.loadRate = rate;
        this.persist();
      }
    },
    lockPlan() {
      if (this.conflicts.length === 0 && this.openComments.length === 0) {
        this.locked = true;
        this.revision += 1;
        graphqlClient.writeQuery({
          query: LIFT_PLAN_QUERY,
          variables: { id: 'LP-2026-0918' },
          data: { liftPlan: { __typename: 'LiftPlan', id: 'LP-2026-0918', name: '东塔转换桁架吊装', revision: this.revision, status: 'LOCKED', steps: this.steps } }
        });
      }
      this.persist();
    },

    // ---------- 吊车档案 ----------
    updateCraneArchive(craneId: string, patch: Partial<CraneArchive>) {
      const index = this.cranes.findIndex((item) => item.id === craneId);
      if (index < 0) return;
      const before = this.cranes[index];
      const after: CraneArchive = { ...before, ...patch, updatedAt: clockTime() };
      this.cranes[index] = after;

      const kind: ChangeKind =
        patch.chartVersion !== undefined || patch.chart !== undefined || patch.counterweight !== undefined || patch.ratedTon !== undefined
          ? 'crane-chart'
          : 'crane-pad';
      // 档案一变：所有以该吊车为基准 / 为替换目标的步骤关联签署失效
      const affectedSteps = this.steps
        .filter((step) => step.snapshot?.craneId === craneId || this.activeRequest?.targetCraneId === craneId)
        .map((step) => step.id);
      this.steps.forEach((step) => {
        if (step.snapshot?.craneId === craneId) {
          const fresh = snapshotFor(after, step, now());
          const stale =
            fresh.ratedCapacity !== step.snapshot.ratedCapacity ||
            fresh.padLength !== step.snapshot.padLength ||
            fresh.padWidth !== step.snapshot.padWidth ||
            step.snapshot.groundCapacity !== step.groundCapacity;
          step.snapshot.stale = stale;
        }
      });
      this.invalidateForChange(kind, affectedSteps, `吊车档案 ${after.model} 变更`);
      this.persist();
    },

    // ---------- 发起替换 ----------
    submitReplacement(input: { targetCraneId: string; applicant: string; applicantTeam?: string; note?: string }): {
      ok: boolean;
      requestId?: string;
      retained?: boolean;
      duplicate?: boolean;
      message: string;
    } {
      const target = this.cranes.find((item) => item.id === input.targetCraneId);
      if (!target) return { ok: false, message: '吊车档案不存在' };
      if (target.id === this.currentCraneId) return { ok: false, message: '替换吊车与现行主吊相同，无需替换' };

      // 重复申请（同申请人 + 同目标，进行中 / 已保留）不生成第二版
      const dup = this.replacements.find(
        (item) =>
          item.targetCraneId === target.id &&
          item.applicant === input.applicant &&
          (item.status === 'active' || item.status === 'retained')
      );
      if (dup) {
        return {
          ok: false,
          duplicate: true,
          requestId: dup.id,
          message: `重复申请已拦截：${input.applicant} 对 ${target.model} 的申请 ${dup.id} 已存在，不生成第二版，可在原申请续作。`
        };
      }

      // 同一台吊车并发：先到者生效（进入 active），后到者保留申请与差异
      const priorSameTarget = this.replacements.find(
        (item) => item.targetCraneId === target.id && (item.status === 'active' || item.status === 'retained')
      );

      const id = `RP-${String(this.seq).padStart(3, '0')}`;
      this.seq += 1;
      const submittedAt = clockTime();

      // 1) 冻结方案版本：逐步骤留基准；旧步骤没有设备快照时先备份当前值
      const fromCrane = this.currentCrane;
      const steps: LiftStep[] = this.steps.map((step) => {
        if (!step.snapshot) {
          const backup = {
            craneModel: fromCrane.model,
            loadRate: step.loadRate,
            radius: step.radius,
            boom: step.boom,
            reason: `发起替换 ${id}：旧步骤无设备快照，先备份当前值再升级`,
            backedAt: submittedAt
          };
          const snap = snapshotFor(fromCrane, step, submittedAt);
          return { ...step, snapshot: { ...snap, backup } };
        }
        return step;
      });
      this.steps = steps;

      const basis: Record<string, string> = {};
      this.steps.forEach((step) => {
        basis[step.id] = step.snapshot ? stepBasisSignature(fromCrane, step) : '';
      });

      // 2) 按步骤作业半径 / 荷载率逐项查起重性能表，支腿反力比对地基承载力
      const results = runChecks(target, this.steps);
      const summary = summarizeOutcome(results);
      const impacted = results.filter((item) => item.impacted);

      // 3) 为受影响步骤建立四个角色的签署位（替换影响全部角色）
      const request: ReplacementRequest = {
        id,
        applicant: input.applicant,
        applicantTeam: input.applicantTeam ?? '现场吊装组',
        submittedAt,
        fromCraneId: this.currentCraneId,
        targetCraneId: target.id,
        status: priorSameTarget ? 'retained' : 'active',
        note: input.note ?? '',
        freeze: {
          revision: this.revision,
          frozenAt: submittedAt,
          craneId: fromCrane.id,
          chartVersion: fromCrane.chartVersion,
          basis
        },
        diff: buildCraneDiff(fromCrane, target),
        checks: CHECK_TEMPLATE.map((item) => ({ ...item, confirmed: false })),
        results,
        outcome: {
          status: summary.status,
          reason: summary.reason,
          failedIds: summary.failed.map((item) => item.stepId),
          impactedIds: impacted.map((item) => item.stepId)
        },
        basisVersion: 1,
        basisEvents: [],
        closedNote: summary.reason
      };

      if (priorSameTarget) {
        const priorResults = priorSameTarget.results.filter((item) => !item.pass).length;
        request.retained = {
          priorRequestId: priorSameTarget.id,
          diff: buildRetainedDiff({
            priorApplicant: priorSameTarget.applicant,
            priorSubmittedAt: priorSameTarget.submittedAt,
            priorId: priorSameTarget.id,
            applicant: input.applicant,
            submittedAt,
            priorFailed: priorResults,
            failed: results.filter((item) => !item.pass).length
          })
        };
        request.duplicateOf = priorSameTarget.id;
        this.replacements.push(request);
        this.persist();
        return {
          ok: true,
          retained: true,
          requestId: id,
          message: `同设备并发：${priorSameTarget.id}（${priorSameTarget.applicant}）先到生效，本申请 ${id} 已保留申请与差异。`
        };
      }

      // 先到者：建立签署位
      impacted.forEach((result) => {
        SIGN_ROLES.forEach((role) => {
          this.signoffs.push({
            id: `${id}:${role.role}:${result.stepId}`,
            requestId: id,
            role: role.role,
            person: role.person,
            stepId: result.stepId,
            state: 'pending',
            basis: basis[result.stepId] ?? ''
          });
        });
      });

      this.replacements.push(request);
      this.resumeNotice = `方案 V${this.revision} 已随替换申请 ${id} 冻结，校核从第 1 项开始。`;
      this.persist();
      return {
        ok: true,
        requestId: id,
        message:
          summary.status === 'rejected'
            ? `申请 ${id} 已建立并冻结基准，但校核结论为拒绝：${summary.reason}`
            : `申请 ${id} 已建立并冻结方案 V${this.revision}，逐项校核全部通过，继续确认与会签。`
      };
    },

    // ---------- 逐项确认（导出 / 保存中断从最后确认项续作） ----------
    confirmCheck(requestId: string, key: string, by = '现场指挥'): { ok: boolean; message: string } {
      const request = this.replacements.find((item) => item.id === requestId);
      if (!request || request.status !== 'active') return { ok: false, message: '申请不在生效中，不能确认。' };
      const index = request.checks.findIndex((item) => item.key === key);
      if (index < 0) return { ok: false, message: '确认项不存在。' };
      if (request.checks[index].confirmed) return { ok: true, message: '该项已确认。' };
      // 顺序确认：只能确认最后确认项的下一项
      const prev = request.checks.slice(0, index).find((item) => !item.confirmed);
      if (prev) return { ok: false, message: `请先完成上一项：${prev.label}` };
      if (key === 'signoff' && request.outcome.status === 'rejected') {
        return { ok: false, message: '校核已被拒绝（支腿地基 / 起重性能不满足），不能进入会签确认。' };
      }
      if (key === 'signoff') {
        const pending = this.signoffs.filter((item) => item.requestId === requestId && item.state !== 'signed');
        if (pending.length > 0) {
          return { ok: false, message: `还有 ${pending.length} 个对应角色签署未完成或已失效待重签。` };
        }
      }
      request.checks[index] = { ...request.checks[index], confirmed: true, confirmedAt: clockTime(), confirmedBy: by };
      request.lastConfirmedKey = key;
      this.persist();
      const done = request.checks.filter((item) => item.confirmed).length;
      this.resumeNotice = `已保存到第 ${done} 项「${request.checks[index].label}」；中断或刷新后将从「${
        request.checks.find((item) => !item.confirmed)?.label ?? '全部确认项'
      }」续作。`;
      return { ok: true, message: this.resumeNotice };
    },
    clearResumeNotice() {
      this.resumeNotice = '';
      this.persist();
    },

    // ---------- 角色会签 ----------
    signRole(requestId: string, role: string, stepId: string, opinion = '同意替换', person?: string) {
      const item = this.signoffs.find((sign) => sign.id === `${requestId}:${role}:${stepId}`);
      if (!item) return;
      if (item.state === 'invalid') {
        item.invalidReason = '签署依据已重算，请在最新校核结果上重新签署';
        this.persist();
        return;
      }
      item.state = 'signed';
      item.signedAt = clockTime();
      item.opinion = opinion;
      if (person) item.person = person;
      this.persist();
    },

    // ---------- 参数变更 → 失效重算 ----------
    invalidateForChange(kind: ChangeKind, stepIds: string[], source: string) {
      const roles = rolesForChange(kind);
      const active = this.replacements.find((item) => item.status === 'active');
      if (active) {
        const target = this.cranes.find((crane) => crane.id === active.targetCraneId);
        if (target) {
          // 立即按新参数重算全部步骤
          active.results = runChecks(target, this.steps);
          const summary = summarizeOutcome(active.results);
          const previousFailed = new Set(active.outcome.failedIds);
          active.outcome = {
            status: summary.status,
            reason: summary.reason,
            failedIds: summary.failed.map((item) => item.stepId),
            impactedIds: summary.impacted.map((item) => item.stepId)
          };
          active.basisVersion += 1;
          active.basisEvents.push({ at: clockTime(), kind, message: `${source}：${CHANGE_KIND_LABELS[kind]}，关联步骤与冲突已重算` });

          // 受影响步骤的对应角色签署立即失效；其他步骤照旧
          const impactedIds = summary.impacted.map((item) => item.stepId);
          const scope = stepIds.length > 0 ? Array.from(new Set([...stepIds, ...impactedIds])) : impactedIds;
          this.signoffs.forEach((sign) => {
            if (sign.requestId !== active.id) return;
            if (!roles.includes(sign.role)) return;
            if (!scope.includes(sign.stepId)) return;
            if (sign.state === 'signed') {
              sign.state = 'invalid';
              sign.invalidReason = `${source}（${CHANGE_KIND_LABELS[kind]}），签署依据已变更`;
            } else {
              sign.invalidReason = `等待按新依据签署：${CHANGE_KIND_LABELS[kind]}`;
            }
            sign.basis = active.freeze.basis[sign.stepId] ?? sign.basis;
          });

          // 已确认的"受影响步骤/会签"两项若结论被推翻也要回头
          const impactCheck = active.checks.find((item) => item.key === 'impact');
          const signCheck = active.checks.find((item) => item.key === 'signoff');
          const affectedNow = summary.impacted.some((item) => item.stepId === stepIds[0]) || summary.failed.length !== previousFailed.size;
          if (impactCheck?.confirmed && affectedNow) impactCheck.confirmed = false;
          if (signCheck?.confirmed) signCheck.confirmed = false;
        }
      }
      this.persist();
    },

    // ---------- 接受 / 拒绝 / 撤回 ----------
    acceptReplacement(requestId: string): { ok: boolean; message: string } {
      const request = this.replacements.find((item) => item.id === requestId);
      if (!request || request.status !== 'active') return { ok: false, message: '申请不在生效中。' };
      if (request.outcome.status === 'rejected') return { ok: false, message: request.outcome.reason ?? '校核未通过，不能接受替换。' };
      const unconfirmed = request.checks.filter((item) => !item.confirmed);
      if (unconfirmed.length > 0) return { ok: false, message: `还差确认项：${unconfirmed.map((item) => item.label).join('、')}` };
      const pending = this.signoffs.filter((item) => item.requestId === requestId && item.state !== 'signed');
      if (pending.length > 0) return { ok: false, message: `还有 ${pending.length} 个角色签署未完成或已失效。` };

      const target = this.cranes.find((crane) => crane.id === request.targetCraneId);
      if (!target) return { ok: false, message: '目标吊车档案缺失。' };

      const capturedAt = clockTime();
      this.steps = this.steps.map((step) => {
        const result = request.results.find((item) => item.stepId === step.id);
        const snapshot = snapshotFor(target, step, capturedAt);
        return {
          ...step,
          snapshot,
          loadRate: result?.loadRate !== null && result?.loadRate !== undefined ? Math.round(result.loadRate) : step.loadRate,
          status: result && !result.pass ? 'blocked' : step.status === 'blocked' && result?.pass ? 'pending' : step.status
        };
      });
      this.currentCraneId = target.id;
      request.status = 'accepted';
      request.acceptedAt = capturedAt;
      request.closedNote = `替换已接受，主吊变更为 ${target.model}，方案升版 V${this.revision + 1}`;
      this.revision += 1;
      this.resumeNotice = `${request.id} 替换接受完成，已从最后确认项收口，无重复版本。`;
      this.persist();
      return { ok: true, message: request.closedNote };
    },
    rejectActive(requestId: string, note = '支腿地基 / 起重性能校核不通过，拒绝替换') {
      const request = this.replacements.find((item) => item.id === requestId);
      if (!request || request.status !== 'active') return;
      request.status = 'rejected';
      request.rejectedAt = clockTime();
      request.closedNote = note;
      this.persist();
    },
    withdrawRequest(requestId: string) {
      const request = this.replacements.find((item) => item.id === requestId);
      if (!request) return;
      if (request.status === 'active' || request.status === 'retained') {
        request.status = 'withdrawn';
        request.closedNote = '申请人撤回';
        this.persist();
      }
    },
    promoteRetained(requestId: string): { ok: boolean; message: string } {
      // 先到者关闭（接受/拒绝/撤回）后，后到者可转为生效，沿用其保留的申请与差异
      const request = this.replacements.find((item) => item.id === requestId);
      if (!request || request.status !== 'retained') return { ok: false, message: '仅保留中的申请可转生效。' };
      if (this.replacements.some((item) => item.status === 'active')) return { ok: false, message: '仍有先到申请生效中。' };
      const target = this.cranes.find((crane) => crane.id === request.targetCraneId);
      if (!target) return { ok: false, message: '目标吊车档案缺失。' };
      request.status = 'active';
      request.results = runChecks(target, this.steps);
      const summary = summarizeOutcome(request.results);
      request.outcome = {
        status: summary.status,
        reason: summary.reason,
        failedIds: summary.failed.map((item) => item.stepId),
        impactedIds: summary.impacted.map((item) => item.stepId)
      };
      const existing = new Set(this.signoffs.map((item) => item.id));
      summary.impacted.forEach((result) => {
        SIGN_ROLES.forEach((role) => {
          const id = `${request.id}:${role.role}:${result.stepId}`;
          if (!existing.has(id)) {
            this.signoffs.push({ id, requestId: request.id, role: role.role, person: role.person, stepId: result.stepId, state: 'pending', basis: request.freeze.basis[result.stepId] ?? '' });
          }
        });
      });
      this.persist();
      return { ok: true, message: `保留申请 ${request.id} 已转为生效，校核结果已按当前参数重算。` };
    },

    resetDemo() {
      const fresh = freshState();
      Object.assign(this, fresh);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(cacheKey);
      this.persist();
    },

    persist() {
      if (typeof localStorage === 'undefined') return;
      const payload: Persisted = {
        schemaVersion: this.schemaVersion,
        cranes: this.cranes,
        currentCraneId: this.currentCraneId,
        steps: this.steps,
        comments: this.comments,
        selectedStepId: this.selectedStepId,
        revision: this.revision,
        locked: this.locked,
        viewBookmarks: this.viewBookmarks,
        activeBookmark: this.activeBookmark,
        replacements: this.replacements,
        signoffs: this.signoffs,
        seq: this.seq,
        resumeNotice: this.resumeNotice
      };
      localStorage.setItem(cacheKey, JSON.stringify(payload));
    }
  }
});
