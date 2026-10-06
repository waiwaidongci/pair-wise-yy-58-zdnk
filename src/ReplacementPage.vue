<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLiftStore } from './store';
import { useReplacementStore } from './replacement/store';

const lift = useLiftStore();
const store = useReplacementStore();

const editingCraneId = ref<string | null>(null);
const editingFoundation = ref(false);
const applicant = ref('王工');
const flash = ref('');

const activeOrder = computed(() => store.activeOrder);
const supersededOrders = computed(() => store.orders.filter((o) => o.status === 'superseded'));
const resumableOrder = computed(
  () => store.orders.find((o) => !o.exported && o.lastConfirmedIndex >= 0 && o.status !== 'superseded' && o.id !== activeOrder.value?.id) ?? null
);

function flashMsg(msg: string) {
  flash.value = msg;
  window.setTimeout(() => (flash.value = ''), 4200);
}

function submit(craneId: string) {
  const res = store.submitReplacement(craneId, applicant.value || '王工');
  if (!res) return;
  if (res.duplicated) {
    flashMsg(`重复申请未生成两版：已从最后确认项续作（${res.order.code}）`);
  } else if (res.order.status === 'superseded') {
    flashMsg(`后到申请 ${res.order.code} 已保留，先到者生效`);
  } else if (res.order.status === 'rejected') {
    flashMsg(`替换申请 ${res.order.code} 被拒绝：支腿反力超过地基承载力或荷载率超限`);
  } else {
    flashMsg(`替换申请 ${res.order.code} 校核通过`);
  }
}

// 模拟两人（王工 / 李工）同时提交同一台吊车：先到者生效，后到者保留申请与差异
function simulateConcurrent() {
  const craneId = 'crane-02';
  const a = store.submitReplacement(craneId, '王工');
  const b = store.submitReplacement(craneId, '李工');
  if (a && b) {
    flashMsg(`并发提交：${a.order.code}（王工，序号 ${a.order.sequence}）生效；${b.order.code}（李工，序号 ${b.order.sequence}）保留在案`);
  }
}

function onStepParamChange(stepId: string) {
  lift.selectStep(stepId);
  lift.updateStep({});
}

function startEditCrane(id: string) {
  editingCraneId.value = editingCraneId.value === id ? null : id;
}

function saveCrane(id: string) {
  store.updateCrane(id, {});
  editingCraneId.value = null;
  flashMsg('吊车档案已更新，关联步骤已失效重算');
}

function saveFoundation() {
  store.updateFoundation({});
  editingFoundation.value = false;
  flashMsg('地基承载力已更新，关联步骤已失效重算');
}

function resume(orderId: string) {
  store.resumeOrder(orderId);
  flashMsg('已从最后确认项续作');
}

async function doExport(orderId: string) {
  await store.exportOrder(orderId);
  const o = store.orders.find((x) => x.id === orderId);
  if (o?.interrupted) flashMsg('导出中断：已从最后确认项保存，可续作');
  else flashMsg('导出完成，全部确认项已落盘');
}

function statusLabel(s: string) {
  return ({ frozen: '已冻结', passed: '通过', rejected: '拒绝', superseded: '已被取代' } as Record<string, string>)[s] ?? s;
}
function statusColor(s: string) {
  return ({ frozen: 'info', passed: 'positive', rejected: 'negative', superseded: 'grey' } as Record<string, string>)[s] ?? 'grey';
}
function signoffColor(s: string) {
  return s === 'signed' ? 'positive' : s === 'invalid' ? 'negative' : 'grey';
}
function signoffLabel(s: string) {
  return s === 'signed' ? '已签署' : s === 'invalid' ? '已失效' : '待确认';
}
</script>

<template>
  <div class="replace-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">LP-2026-0918 / 替换校核</div>
        <h1>主吊替换校核</h1>
      </div>
      <div class="heading-actions">
        <q-input v-model="applicant" dense outlined label="申请人" class="applicant-input" />
        <q-btn outline no-caps icon="group" label="模拟两人同时提交同台吊车" @click="simulateConcurrent" />
      </div>
    </header>

    <q-banner v-if="flash" rounded dense class="flash-banner" color="teal" text-color="white">
      {{ flash }}
    </q-banner>

    <!-- 吊车档案 -->
    <section class="content-panel">
      <div class="panel-heading">
        <div>
          <span class="panel-kicker">CRANE ARCHIVE</span>
          <h2>吊车档案与起重性能表</h2>
        </div>
        <span class="panel-hint">发起替换先冻结方案版本；换车后按新车性能表逐步骤重新求荷载率</span>
      </div>
      <div class="crane-grid">
        <article v-for="crane in store.cranes" :key="crane.id" class="crane-card" :class="{ current: crane.id === store.currentCraneId }">
          <div class="crane-head">
            <div>
              <strong>{{ crane.model }}</strong>
              <small>{{ crane.code }} · {{ crane.name }}</small>
            </div>
            <q-banner v-if="crane.id === store.currentCraneId" dense rounded color="teal" text-color="white">原方案主吊</q-banner>
          </div>

          <div class="crane-params">
            <div><span>自重</span><strong>{{ crane.selfWeightT }} t</strong></div>
            <div><span>空载支腿反力</span>
              <strong v-if="editingCraneId !== crane.id">{{ crane.outriggerBaseReactionKn }} kN</strong>
              <q-input v-else v-model.number="crane.outriggerBaseReactionKn" type="number" dense outlined />
            </div>
            <div><span>每t荷载反力增量</span>
              <strong v-if="editingCraneId !== crane.id">{{ crane.outriggerPerLoadKnPerT }} kN/t</strong>
              <q-input v-else v-model.number="crane.outriggerPerLoadKnPerT" type="number" step="0.1" dense outlined />
            </div>
            <div><span>单腿最大反力</span><strong>{{ crane.maxOutriggerReactionKn }} kN</strong></div>
          </div>

          <div class="perf-table">
            <span class="perf-title">起重性能表（额定起重量 / t）</span>
            <div class="perf-row"><span>半径 m</span><span v-for="p in crane.performance" :key="p.radius">{{ p.radius }}</span></div>
            <div class="perf-row"><span>起重量 t</span><span v-for="p in crane.performance" :key="p.radius">{{ p.capacity }}</span></div>
          </div>

          <div class="crane-actions">
            <q-btn v-if="crane.id !== store.currentCraneId" color="primary" no-caps icon="swap_horiz" label="发起替换" @click="submit(crane.id)" />
            <q-btn v-if="editingCraneId === crane.id" color="teal" no-caps icon="check" label="保存并重算" @click="saveCrane(crane.id)" />
            <q-btn flat no-caps :icon="editingCraneId === crane.id ? 'close' : 'edit'" :label="editingCraneId === crane.id ? '取消' : '编辑档案'" @click="startEditCrane(crane.id)" />
          </div>
        </article>
      </div>
    </section>

    <!-- 地基承载力 -->
    <section class="content-panel foundation-panel">
      <div class="panel-heading">
        <div>
          <span class="panel-kicker">FOUNDATION</span>
          <h2>支腿地基承载力</h2>
        </div>
        <q-btn flat no-caps :icon="editingFoundation ? 'close' : 'edit'" :label="editingFoundation ? '取消' : '编辑地基参数'" @click="editingFoundation = !editingFoundation" />
      </div>
      <div class="foundation-grid">
        <div><span>站位区</span><strong>{{ store.foundation.site }}</strong></div>
        <div><span>地基承载力特征值</span>
          <strong v-if="!editingFoundation">{{ store.foundation.bearingCapacityKpa }} kPa</strong>
          <q-input v-else v-model.number="store.foundation.bearingCapacityKpa" type="number" dense outlined />
        </div>
        <div><span>垫板面积</span>
          <strong v-if="!editingFoundation">{{ store.foundation.plateAreaM2 }} m²（{{ store.foundation.plateLabel }}）</strong>
          <q-input v-else v-model.number="store.foundation.plateAreaM2" type="number" step="0.1" dense outlined />
        </div>
      </div>
      <div v-if="editingFoundation" class="foundation-save">
        <q-btn color="teal" no-caps icon="check" label="保存并重算关联步骤" @click="saveFoundation" />
      </div>
    </section>

    <!-- 续作提示 -->
    <q-banner v-if="resumableOrder" rounded class="resume-banner" color="amber" text-color="black">
      <div class="resume-row">
        <span>草稿 {{ resumableOrder.code }} 导出中断于第 {{ resumableOrder.lastConfirmedIndex + 1 }} 项，从最后确认项续作。</span>
        <q-btn color="primary" no-caps label="继续" @click="resume(resumableOrder.id)" />
      </div>
    </q-banner>

    <!-- 当前生效替换校核 -->
    <section v-if="activeOrder" class="content-panel">
      <div class="panel-heading">
        <div>
          <span class="panel-kicker">REPLACEMENT CHECK</span>
          <h2>替换校核 · {{ activeOrder.code }}</h2>
        </div>
        <div class="head-badges">
          <q-badge :color="statusColor(activeOrder.status)">{{ statusLabel(activeOrder.status) }}</q-badge>
          <q-badge color="deep-purple">冻结版本 V{{ activeOrder.frozenRevision }}</q-badge>
          <q-badge color="blue-grey">序号 {{ activeOrder.sequence }}</q-badge>
        </div>
      </div>

      <div class="order-meta">
        <span>申请：<strong>{{ activeOrder.applicant }}</strong></span>
        <span>原主吊：<strong>{{ store.craneById(activeOrder.originalCraneId)?.model }}</strong></span>
        <span>替换为：<strong>{{ activeOrder.targetCraneModel }}</strong></span>
        <span>冻结时间：<strong>{{ new Date(activeOrder.frozenAt).toLocaleString('zh-CN') }}</strong></span>
        <span v-if="activeOrder.exported" class="exported-tag"><q-icon name="verified" /> 已导出</span>
      </div>

      <q-banner v-if="activeOrder.status === 'superseded'" rounded class="superseded-banner" color="grey-3" text-color="black">
        <strong>后到申请保留在案：</strong>{{ activeOrder.differenceNote }}
      </q-banner>

      <div v-if="activeOrder.rejectReasons.length" class="reject-box">
        <strong>拒绝原因</strong>
        <ul>
          <li v-for="(r, i) in activeOrder.rejectReasons" :key="i">{{ r }}</li>
        </ul>
      </div>

      <div class="affected-bar">
        <strong>受影响步骤（{{ activeOrder.affectedStepIds.length }}）：</strong>
        <span v-if="activeOrder.affectedStepIds.length === 0" class="ok-text">无</span>
        <q-chip v-for="id in activeOrder.affectedStepIds" :key="id" dense color="negative" text-color="white">{{ id }}</q-chip>
      </div>

      <!-- 逐项校核表 -->
      <div class="check-table-wrap">
        <table class="check-table">
          <thead>
            <tr>
              <th>步骤</th>
              <th>作业半径 m</th>
              <th>原荷载率 %</th>
              <th>实际吊重 t</th>
              <th>额定起重量 t</th>
              <th>换车后荷载率</th>
              <th>支腿反力 kN</th>
              <th>对地耐力 kPa</th>
              <th>结论</th>
              <th>设备快照（备份）</th>
              <th>确认</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in activeOrder.checks" :key="c.stepId" :class="{ 'row-fail': !c.passed, 'row-changed': c.changed, 'row-invalid': c.invalidated }">
              <td class="step-cell">
                <strong>{{ c.stepId }}</strong>
                <small>{{ c.title }}</small>
              </td>
              <td>
                <q-input
                  v-model.number="lift.steps.find(s => s.id === c.stepId)!.radius"
                  type="number" dense outlined
                  @change="onStepParamChange(c.stepId)"
                />
              </td>
              <td>
                <q-input
                  v-model.number="lift.steps.find(s => s.id === c.stepId)!.loadRate"
                  type="number" dense outlined
                  @change="onStepParamChange(c.stepId)"
                />
              </td>
              <td>{{ c.actualLoadT ?? '—' }}</td>
              <td>{{ c.ratedCapacityT ?? '—' }}</td>
              <td>
                <span :class="{ 'danger-text': c.newLoadRate !== null && c.newLoadRate > 100 }">{{ c.newLoadRate ?? '—' }}<template v-if="c.newLoadRate !== null">%</template></span>
              </td>
              <td>{{ c.outriggerReactionKn ?? '—' }}</td>
              <td>
                <span :class="{ 'danger-text': c.groundPressureKpa !== null && c.groundPressureKpa > store.foundation.bearingCapacityKpa }">
                  {{ c.groundPressureKpa ?? '—' }}
                  <small>/ {{ store.foundation.bearingCapacityKpa }}</small>
                </span>
              </td>
              <td class="verdict-cell">
                <q-badge v-if="c.passed && !c.invalidated" color="positive">通过</q-badge>
                <q-badge v-else-if="c.invalidated" color="warning">已失效</q-badge>
                <q-badge v-else color="negative">拒绝</q-badge>
                <ul v-if="c.issues.length" class="issue-list">
                  <li v-for="(iss, i) in c.issues" :key="i">{{ iss }}</li>
                </ul>
              </td>
              <td class="snapshot-cell">
                <small>{{ c.snapshot.craneModel }}</small>
                <small v-if="c.snapshot.backup" class="backup-note">
                  备份：{{ c.snapshot.backup.craneId }} / {{ c.snapshot.backup.radius }}m / {{ c.snapshot.backup.loadRate }}%
                </small>
              </td>
              <td>
                <q-checkbox
                  :model-value="c.confirmed"
                  :disable="c.invalidated || activeOrder.status === 'superseded'"
                  @update:model-value="store.confirmStep(activeOrder.id, c.stepId)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 会签 -->
      <div class="signoff-panel">
        <h3>对应角色会签（参数变化后对应签署立即失效重签）</h3>
        <div class="signoff-grid">
          <div v-for="so in activeOrder.signoffs" :key="so.role" class="signoff-card" :class="so.status">
            <div class="signoff-head">
              <strong>{{ so.label }}</strong>
              <q-badge :color="signoffColor(so.status)">{{ signoffLabel(so.status) }}</q-badge>
            </div>
            <span>{{ so.name }}</span>
            <q-btn
              v-if="so.status !== 'signed'"
              color="primary" no-caps size="sm"
              :label="so.status === 'invalid' ? '重新签署' : '签署'"
              @click="store.signRole(activeOrder.id, so.role)"
            />
            <q-btn v-else disable no-caps size="sm" label="已签署" />
          </div>
        </div>
      </div>

      <!-- 导出 / 续作 -->
      <div class="export-bar">
        <div class="progress-text">
          已确认 {{ activeOrder.lastConfirmedIndex + 1 }} / {{ activeOrder.checks.length }} 项
          <q-linear-progress v-if="activeOrder.exporting" indeterminate color="teal" class="export-progress" />
        </div>
        <div class="export-actions">
          <q-btn v-if="activeOrder.interrupted" color="amber" text-color="black" no-caps icon="play_arrow" label="从最后确认项续作" @click="doExport(activeOrder.id)" />
          <q-btn v-if="activeOrder.exporting" color="negative" no-caps icon="stop" label="模拟中断" @click="store.interruptExport()" />
          <q-btn v-if="!activeOrder.exporting" color="primary" no-caps icon="ios_share" label="导出校核单" @click="doExport(activeOrder.id)" />
        </div>
      </div>
    </section>

    <!-- 并发申请记录 -->
    <section v-if="supersededOrders.length" class="content-panel">
      <div class="panel-heading">
        <div>
          <span class="panel-kicker">CONCURRENCY</span>
          <h2>并发申请记录（先到者生效 · 后到者保留）</h2>
        </div>
      </div>
      <div class="superseded-list">
        <article v-for="o in supersededOrders" :key="o.id" class="superseded-item">
          <div class="superseded-head">
            <strong>{{ o.code }}</strong>
            <q-badge color="grey">已被 {{ store.orders.find(w => w.id === o.supersededById)?.code }} 取代</q-badge>
            <span>{{ o.applicant }} · 序号 {{ o.sequence }}</span>
          </div>
          <p class="diff-note">{{ o.differenceNote }}</p>
          <div class="superseded-meta">
            <span>结论：{{ statusLabel(o.status) }}</span>
            <span>受影响步骤 {{ o.affectedStepIds.length }} 项</span>
            <span>拒绝原因：{{ o.rejectReasons.join('；') || '无' }}</span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.replace-page { display: flex; flex-direction: column; gap: 16px; }
.page-heading { display: flex; justify-content: space-between; align-items: end; gap: 18px; }
.page-heading h1 { margin: 3px 0 0; font-size: 27px; letter-spacing: -.02em; }
.eyebrow { color: #70857d; font-size: 11px; font-weight: 750; letter-spacing: .11em; }
.heading-actions { display: flex; gap: 8px; align-items: center; }
.applicant-input { width: 130px; }
.flash-banner { margin-bottom: 4px; }
.content-panel { background: #fff; border: 1px solid #d9e1dd; border-radius: 8px; box-shadow: 0 8px 24px rgba(27,51,42,.05); overflow: hidden; }
.panel-heading { min-height: 60px; padding: 15px 17px; display: flex; justify-content: space-between; align-items: center; gap: 14px; border-bottom: 1px solid #d9e1dd; }
.panel-heading h2 { margin: 3px 0 0; font-size: 16px; }
.panel-kicker { color: #70857d; font-size: 11px; font-weight: 750; letter-spacing: .11em; }
.panel-hint { color: #75867f; font-size: 11px; }
.crane-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; padding: 16px; }
.crane-card { border: 1px solid #d9e1dd; border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.crane-card.current { border-color: #146c5a; background: #f3faf7; }
.crane-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.crane-head strong { font-size: 15px; }
.crane-head small { display: block; color: #75867f; font-size: 11px; margin-top: 2px; }
.crane-params { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.crane-params > div { border: 1px solid #e2e9e6; background: #f8faf9; border-radius: 5px; padding: 8px; }
.crane-params span { display: block; color: #70857d; font-size: 11px; }
.crane-params strong { display: block; margin-top: 3px; font-size: 14px; }
.perf-table { border-top: 1px dashed #d9e1dd; padding-top: 8px; }
.perf-title { display: block; color: #70857d; font-size: 11px; margin-bottom: 6px; }
.perf-row { display: flex; gap: 4px; font-size: 11px; color: #52675f; }
.perf-row span { flex: 1; text-align: center; padding: 2px 0; }
.perf-row span:first-child { flex: 1.6; text-align: left; color: #70857d; }
.crane-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.foundation-panel { padding-bottom: 16px; }
.foundation-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px; }
.foundation-grid > div { border: 1px solid #e2e9e6; background: #f8faf9; border-radius: 5px; padding: 10px; }
.foundation-grid span { display: block; color: #70857d; font-size: 11px; }
.foundation-grid strong { display: block; margin-top: 4px; font-size: 15px; }
.foundation-save { padding: 0 16px; }
.resume-banner { margin-bottom: 4px; }
.resume-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.head-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.order-meta { display: flex; gap: 18px; flex-wrap: wrap; padding: 12px 17px; color: #52675f; font-size: 12px; border-bottom: 1px solid #eef2f0; }
.order-meta strong { color: #183129; }
.exported-tag { color: #2b8a69; display: inline-flex; align-items: center; gap: 3px; }
.superseded-banner { margin: 12px 17px 0; }
.reject-box { margin: 12px 17px 0; padding: 12px 14px; background: #fdecea; border: 1px solid #f3c1bd; border-radius: 6px; color: #a7312b; font-size: 12px; }
.reject-box ul { margin: 6px 0 0; padding-left: 18px; }
.affected-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 17px; font-size: 12px; }
.ok-text { color: #2b8a69; }
.check-table-wrap { padding: 0 17px; overflow-x: auto; }
.check-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1100px; }
.check-table th { text-align: left; color: #70857d; font-size: 11px; font-weight: 700; padding: 8px 6px; border-bottom: 1px solid #d9e1dd; white-space: nowrap; }
.check-table td { padding: 8px 6px; border-bottom: 1px solid #eef2f0; vertical-align: middle; }
.step-cell { min-width: 120px; }
.step-cell small { display: block; color: #75867f; font-size: 10px; margin-top: 2px; }
.row-fail { background: #fdf4f3; }
.row-changed { background: #fffaf0; }
.row-invalid { background: #fff6e5; }
.danger-text { color: #c43b37; font-weight: 700; }
.danger-text small { color: #9aa8a2; font-weight: 400; }
.verdict-cell { min-width: 130px; }
.issue-list { margin: 4px 0 0; padding-left: 14px; color: #a7312b; font-size: 10px; }
.snapshot-cell { min-width: 150px; }
.snapshot-cell small { display: block; color: #52675f; font-size: 10px; }
.backup-note { color: #8a6d3b !important; margin-top: 2px; }
.signoff-panel { padding: 16px 17px; border-top: 1px solid #eef2f0; }
.signoff-panel h3 { margin: 0 0 12px; font-size: 14px; }
.signoff-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.signoff-card { border: 1px solid #d9e1dd; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 6px; background: #fafcfb; }
.signoff-card.signed { border-color: #2b8a69; background: #f3faf7; }
.signoff-card.invalid { border-color: #d98a3b; background: #fff8ef; }
.signoff-head { display: flex; justify-content: space-between; align-items: center; }
.signoff-card span { color: #75867f; font-size: 12px; }
.export-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 17px; border-top: 1px solid #eef2f0; flex-wrap: wrap; }
.progress-text { font-size: 12px; color: #52675f; display: flex; align-items: center; gap: 10px; }
.export-progress { width: 160px; }
.export-actions { display: flex; gap: 8px; }
.superseded-list { padding: 14px 17px; display: flex; flex-direction: column; gap: 10px; }
.superseded-item { border: 1px solid #d9e1dd; border-left: 3px solid #9e9e9e; border-radius: 6px; padding: 12px; background: #fafafa; }
.superseded-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.superseded-head span { color: #75867f; font-size: 12px; }
.diff-note { margin: 0 0 6px; color: #52675f; font-size: 12px; }
.superseded-meta { display: flex; gap: 16px; flex-wrap: wrap; color: #75867f; font-size: 11px; }
@media (max-width: 980px) {
  .crane-grid, .foundation-grid, .signoff-grid { grid-template-columns: 1fr; }
}
</style>
