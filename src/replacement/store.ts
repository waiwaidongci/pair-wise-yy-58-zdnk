import { defineStore } from 'pinia';
import { useLiftStore } from '../store';
import {
  CraneArchive,
  Foundation,
  SIGN_ROLES,
  SignRole,
  evaluateStep,
  initialCranes,
  initialFoundation
} from './cranes';

export type StepCheck = {
  stepId: string;
  title: string;
  radius: number;
  loadRate: number;
  actualLoadT: number | null;
  newLoadRate: number | null;
  ratedCapacityT: number | null;
  outriggerReactionKn: number | null;
  groundPressureKpa: number | null;
  passed: boolean;
  issues: string[];
  role: SignRole;
  affected: boolean;   // 受影响步骤（不通过或参数较冻结值变化）
  changed: boolean;    // 参数较冻结版本发生变化
  confirmed: boolean;  // 已确认项（导出/保存中断后从最后确认项续作）
  invalidated: boolean; // 已失效（需重算、角色需重签）
  snapshot: {
    craneId: string;
    craneModel: string;
    foundationKpa: number;
    plateAreaM2: number;
    backup: { loadRate: number; radius: number; craneId: string } | null; // 升级前旧值备份
  };
};

export type Signoff = {
  role: SignRole;
  label: string;
  name: string;
  status: 'pending' | 'signed' | 'invalid';
  signedAt?: string;
};

export type ReplacementOrder = {
  id: string;
  code: string;
  targetCraneId: string;
  targetCraneModel: string;
  originalCraneId: string;
  status: 'frozen' | 'passed' | 'rejected' | 'superseded';
  frozenRevision: number;
  frozenAt: string;
  applicant: string;
  createdAt: string;
  sequence: number;
  supersededById: string | null;
  differenceNote: string | null;
  checks: StepCheck[];
  lastConfirmedIndex: number;
  version: number;
  signoffs: Signoff[];
  affectedStepIds: string[];
  rejectReasons: string[];
  frozenSteps: { stepId: string; loadRate: number; radius: number }[];
  exporting: boolean;
  interrupted: boolean;
  exported: boolean;
};

const cacheKey = 'yy58-replacement-draft';

function loadState() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
  } catch {
    return null;
  }
}

function buildDifferenceNote(later: ReplacementOrder, winner: ReplacementOrder): string {
  const parts: string[] = [];
  parts.push(`后到申请（${later.applicant}，序号 ${later.sequence}）保留在案，先到者 ${winner.applicant}（序号 ${winner.sequence}）生效`);
  parts.push(`结论：先到者「${winner.status === 'superseded' ? '—' : winner.status}」，后到者「${later.status}」`);
  if (later.affectedStepIds.length !== winner.affectedStepIds.length) {
    parts.push(`受影响步骤 ${later.affectedStepIds.length} 项 vs 先到 ${winner.affectedStepIds.length} 项`);
  }
  const lk = later.rejectReasons.join('；') || '无';
  const wk = winner.rejectReasons.join('；') || '无';
  if (lk !== wk) parts.push(`拒绝原因不同：后到「${lk}」/ 先到「${wk}」`);
  return parts.join('；');
}

export const useReplacementStore = defineStore('replacement', {
  state: () => {
    const saved = loadState();
    return {
      cranes: (saved?.cranes as CraneArchive[]) ?? initialCranes,
      foundation: (saved?.foundation as Foundation) ?? initialFoundation,
      orders: (saved?.orders as ReplacementOrder[]) ?? [],
      activeOrderId: (saved?.activeOrderId as string) ?? null,
      sequence: (saved?.sequence as number) ?? 0,
      currentCraneId: (saved?.currentCraneId as string) ?? 'crane-01',
      exportInterrupt: false
    };
  },
  getters: {
    craneById: (state) => (id: string) => state.cranes.find((c) => c.id === id),
    currentCrane(state): CraneArchive {
      return state.cranes.find((c) => c.id === state.currentCraneId) ?? state.cranes[0];
    },
    activeOrder(state): ReplacementOrder | null {
      return state.orders.find((o) => o.id === state.activeOrderId) ?? null;
    },
    // 同一台吊车当前生效的申请（未被先到者取代）
    effectiveOrderFor: (state) => (craneId: string) =>
      state.orders.find((o) => o.targetCraneId === craneId && o.status !== 'superseded')
  },
  actions: {
    // 发起替换：先冻结方案版本，再按步骤逐项校核
    submitReplacement(targetCraneId: string, applicant: string): { order: ReplacementOrder; duplicated: boolean } | null {
      const lift = useLiftStore();
      const target = this.craneById(targetCraneId);
      if (!target) return null;

      // 重复申请：同一申请人对同一台吊车已有未失效申请 → 不生成两版，从最后确认项续作
      const dup = this.orders.find(
        (o) => o.targetCraneId === targetCraneId && o.applicant === applicant && o.status !== 'superseded'
      );
      if (dup) {
        this.activeOrderId = dup.id;
        this.persist();
        return { order: dup, duplicated: true };
      }

      const order: ReplacementOrder = {
        id: `RO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        code: `TH-${String(this.orders.length + 1).padStart(3, '0')}`,
        targetCraneId,
        targetCraneModel: target.model,
        originalCraneId: this.currentCraneId,
        status: 'frozen',
        frozenRevision: lift.revision,
        frozenAt: new Date().toISOString(),
        applicant,
        createdAt: new Date().toISOString(),
        sequence: ++this.sequence,
        supersededById: null,
        differenceNote: null,
        checks: [],
        lastConfirmedIndex: -1,
        version: 1,
        signoffs: SIGN_ROLES.map((r) => ({ role: r.role, label: r.label, name: r.defaultName, status: 'pending' })),
        affectedStepIds: [],
        rejectReasons: [],
        frozenSteps: lift.steps.map((s) => ({ stepId: s.id, loadRate: s.loadRate, radius: s.radius })),
        exporting: false,
        interrupted: false,
        exported: false
      };

      this.orders.unshift(order);
      this.evaluateOrder(order);

      // 并发：同一台吊车已有先生效申请 → 先到者生效，后到者保留申请与差异
      const winner = this.orders.find((o) => o.targetCraneId === targetCraneId && o.status !== 'superseded' && o.id !== order.id);
      if (winner) {
        order.status = 'superseded';
        order.supersededById = winner.id;
        order.differenceNote = buildDifferenceNote(order, winner);
      }

      this.activeOrderId = order.id;
      this.persist();
      return { order, duplicated: false };
    },

    // 按步骤作业半径 + 荷载率逐项查起重性能表，支腿反力超地基承载力则拒绝
    evaluateOrder(order: ReplacementOrder) {
      const lift = useLiftStore();
      const current = this.craneById(order.originalCraneId) ?? this.currentCrane;
      const target = this.craneById(order.targetCraneId);
      if (!target) return;
      order.checks = lift.steps.map((step) => this.buildCheck(step, order, current, target));
      this.finalizeOrder(order);
    },

    buildCheck(
      step: { id: string; title: string; loadRate: number; radius: number },
      order: ReplacementOrder,
      current: CraneArchive,
      target: CraneArchive
    ): StepCheck {
      const existing = order.checks.find((c) => c.stepId === step.id);
      const ev = evaluateStep(step, current, target, this.foundation);
      const frozen = order.frozenSteps.find((f) => f.stepId === step.id);
      const changed = frozen ? frozen.loadRate !== step.loadRate || frozen.radius !== step.radius : false;
      const check: StepCheck = {
        stepId: step.id,
        title: step.title,
        radius: step.radius,
        loadRate: step.loadRate,
        actualLoadT: ev.actualLoadT,
        newLoadRate: ev.newLoadRate,
        ratedCapacityT: ev.ratedCapacityT,
        outriggerReactionKn: ev.outriggerReactionKn,
        groundPressureKpa: ev.groundPressureKpa,
        passed: ev.passed,
        issues: ev.issues,
        role: ev.role,
        affected: !ev.passed || changed,
        changed,
        confirmed: existing?.confirmed ?? false,
        invalidated: existing?.invalidated ?? false,
        snapshot: existing?.snapshot ?? {
          craneId: target.id,
          craneModel: target.model,
          foundationKpa: this.foundation.bearingCapacityKpa,
          plateAreaM2: this.foundation.plateAreaM2,
          // 旧步骤没有设备快照：先备份当前值再升级
          backup: { loadRate: step.loadRate, radius: step.radius, craneId: current.id }
        }
      };
      return check;
    },

    finalizeOrder(order: ReplacementOrder) {
      order.affectedStepIds = order.checks.filter((c) => c.affected).map((c) => c.stepId);
      const failed = order.checks.filter((c) => !c.passed);
      order.rejectReasons = [...new Set(failed.flatMap((c) => c.issues))];
      if (order.status !== 'superseded') {
        order.status = failed.length > 0 ? 'rejected' : 'passed';
      }
    },

    // 步骤参数一变：仅重算关联步骤，其他步骤照旧；对应角色签署失效
    invalidateStep(stepId: string) {
      const lift = useLiftStore();
      const order = this.activeOrder;
      if (!order) return;
      const step = lift.steps.find((s) => s.id === stepId);
      if (!step) return;
      const current = this.craneById(order.originalCraneId) ?? this.currentCrane;
      const target = this.craneById(order.targetCraneId);
      if (!target) return;
      const idx = order.checks.findIndex((c) => c.stepId === stepId);
      if (idx >= 0) {
        const check = this.buildCheck(step, order, current, target);
        check.invalidated = true;
        check.confirmed = false;
        order.checks[idx] = check;
        const so = order.signoffs.find((s) => s.role === check.role);
        if (so) so.status = 'invalid';
      }
      this.finalizeOrder(order);
      this.persist();
    },

    // 吊车档案一变：关联步骤、冲突和对应角色签署立即失效重算
    invalidateCrane(craneId: string) {
      const lift = useLiftStore();
      for (const order of this.orders) {
        if (order.status === 'superseded') continue;
        if (order.targetCraneId !== craneId && order.originalCraneId !== craneId) continue;
        const current = this.craneById(order.originalCraneId) ?? this.currentCrane;
        const target = this.craneById(order.targetCraneId);
        if (!target) continue;
        order.checks = lift.steps.map((step) => {
          const c = this.buildCheck(step, order, current, target);
          c.invalidated = true;
          c.confirmed = false;
          c.snapshot.craneId = target.id;
          c.snapshot.craneModel = target.model;
          c.snapshot.foundationKpa = this.foundation.bearingCapacityKpa;
          c.snapshot.plateAreaM2 = this.foundation.plateAreaM2;
          return c;
        });
        for (const role of ['equipment', 'scheme'] as SignRole[]) {
          const so = order.signoffs.find((s) => s.role === role);
          if (so) so.status = 'invalid';
        }
        this.finalizeOrder(order);
      }
      this.persist();
    },

    updateCrane(craneId: string, patch: Partial<CraneArchive>) {
      const c = this.cranes.find((x) => x.id === craneId);
      if (c) Object.assign(c, patch);
      this.invalidateCrane(craneId);
    },

    updateFoundation(patch: Partial<Foundation>) {
      Object.assign(this.foundation, patch);
      const lift = useLiftStore();
      for (const order of this.orders) {
        if (order.status === 'superseded') continue;
        const current = this.craneById(order.originalCraneId) ?? this.currentCrane;
        const target = this.craneById(order.targetCraneId);
        if (!target) continue;
        order.checks = lift.steps.map((step) => {
          const c = this.buildCheck(step, order, current, target);
          c.invalidated = true;
          c.confirmed = false;
          c.snapshot.foundationKpa = this.foundation.bearingCapacityKpa;
          c.snapshot.plateAreaM2 = this.foundation.plateAreaM2;
          return c;
        });
        const so = order.signoffs.find((s) => s.role === 'equipment');
        if (so) so.status = 'invalid';
        this.finalizeOrder(order);
      }
      this.persist();
    },

    // 确认某个步骤（续作进度）
    confirmStep(orderId: string, stepId: string) {
      const order = this.orders.find((o) => o.id === orderId);
      if (!order) return;
      const check = order.checks.find((c) => c.stepId === stepId);
      if (!check || check.invalidated) return;
      check.confirmed = true;
      const idx = order.checks.findIndex((c) => c.stepId === stepId);
      if (idx > order.lastConfirmedIndex) order.lastConfirmedIndex = idx;
      this.persist();
    },

    resumeOrder(orderId: string) {
      const order = this.orders.find((o) => o.id === orderId);
      if (!order) return;
      this.activeOrderId = orderId;
      this.exportInterrupt = false;
      this.persist();
    },

    // 导出：从最后确认项续作，逐项确认并落盘；中断后从最后确认项继续
    async exportOrder(orderId: string) {
      const order = this.orders.find((o) => o.id === orderId);
      if (!order) return;
      this.activeOrderId = orderId;
      this.exportInterrupt = false;
      order.exporting = true;
      order.interrupted = false;
      const start = Math.max(0, order.lastConfirmedIndex + 1);
      for (let i = start; i < order.checks.length; i++) {
        if (this.exportInterrupt) {
          order.interrupted = true;
          break;
        }
        const c = order.checks[i];
        if (c.invalidated) {
          order.interrupted = true;
          break;
        }
        c.confirmed = true;
        if (i > order.lastConfirmedIndex) order.lastConfirmedIndex = i;
        this.persist();
        await new Promise((r) => setTimeout(r, 280));
      }
      order.exporting = false;
      if (!order.interrupted) order.exported = true;
      this.persist();
    },

    interruptExport() {
      this.exportInterrupt = true;
    },

    signRole(orderId: string, role: SignRole, name?: string) {
      const order = this.orders.find((o) => o.id === orderId);
      if (!order) return;
      const so = order.signoffs.find((s) => s.role === role);
      if (so && so.status !== 'signed') {
        so.status = 'signed';
        if (name) so.name = name;
        so.signedAt = new Date().toISOString();
      }
      this.persist();
    },

    persist() {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          cranes: this.cranes,
          foundation: this.foundation,
          orders: this.orders,
          activeOrderId: this.activeOrderId,
          sequence: this.sequence,
          currentCraneId: this.currentCraneId
        })
      );
    }
  }
});
