<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLiftStore } from './store';
import { SIGN_ROLES, StepCheck } from './cranes';
import './replace.css';

const store = useLiftStore();

const targetId = ref(store.candidateCranes[0]?.id ?? '');
const applicant = ref('王工');
const applicantTeam = ref('现场吊装组');
const note = ref('');
const flash = ref<{ kind: 'ok' | 'err'; text: string } | null>(null);

const signRoleFilter = ref('all');
const signPerson = ref({ name: '', opinion: '同意临时换用该主吊，按校核参数执行。' });
const editingCraneId = ref(store.currentCraneId);

const active = computed(() => store.activeRequest);
const targetCrane = computed(() =>
  active.value ? store.cranes.find((item) => item.id === active.value!.targetCraneId) : undefined
);
const fromCrane = computed(() =>
  active.value ? store.cranes.find((item) => item.id === active.value!.fromCraneId) : undefined
);
const editingCrane = computed(
  () => store.cranes.find((item) => item.id === editingCraneId.value) ?? store.currentCrane
);

function toast(message: string, ok = true) {
  flash.value = { kind: ok ? 'ok' : 'err', text: message };
  window.setTimeout(() => {
    if (flash.value?.text === message) flash.value = null;
  }, 5200);
}

function submit(second = false) {
  if (!targetId.value) return;
  const result = store.submitReplacement({
    targetCraneId: targetId.value,
    applicant: second ? '李工' : applicant.value || '王工',
    applicantTeam: second ? '设备租赁站' : applicantTeam.value,
    note: note.value
  });
  toast(result.message, result.ok);
  note.value = '';
}

function confirmKey(key: string) {
  if (!active.value) return;
  const result = store.confirmCheck(active.value.id, key);
  toast(result.message, result.ok);
}

function sign(role: string, stepId: string) {
  if (!active.value) return;
  store.signRole(active.value.id, role, stepId, signPerson.value.opinion, signPerson.value.name || undefined);
}

function accept() {
  if (!active.value) return;
  const result = store.acceptReplacement(active.value.id);
  toast(result.message, result.ok);
}
function reject() {
  if (!active.value) return;
  store.rejectActive(active.value.id);
  toast('已拒绝替换并保留全过程记录。');
}
function withdraw(id: string) {
  store.withdrawRequest(id);
  toast('申请已撤回。');
}
function promote(id: string) {
  const result = store.promoteRetained(id);
  toast(result.message, result.ok);
}

function signState(requestId: string, role: string, stepId: string) {
  return store.requestSignoffs(requestId).find((item) => item.role === role && item.stepId === stepId);
}

function updateArchive(patch: Partial<typeof editingCrane.value>) {
  store.updateCraneArchive(editingCrane.value.id, patch);
}

function updatePad(field: 'padLength' | 'padWidth', value: number) {
  updateArchive({ [field]: value } as Partial<typeof editingCrane.value>);
}

function resetDemo() {
  store.resetDemo();
  targetId.value = store.candidateCranes[0]?.id ?? '';
  editingCraneId.value = store.currentCraneId;
  toast('演示数据已重置。');
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}
function kpa(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)} kPa`;
}
function kn(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)} kN`;
}
type QEvt = string | number | null;
function num(handler: (v: number) => void) {
  return (value: QEvt) => handler(Number(value));
}
function txt(handler: (v: string) => void) {
  return (value: QEvt) => handler(String(value ?? ''));
}
function bumpChartVersion() {
  const next = editingCrane.value.chartVersion.replace(/V([\d.]+)$/, (_m: string, v: string) => `V${(Number(v) + 0.1).toFixed(1)}`);
  store.updateCraneArchive(editingCrane.value.id, { chartVersion: next });
}
const STATUS_LABEL: Record<string, string> = { accepted: '已接受', rejected: '已拒绝', active: '生效中', withdrawn: '已撤回' };

const activeSignoffs = computed(() => (active.value ? store.requestSignoffs(active.value.id) : []));
const signRoleState = computed(() => {
  const map: Record<string, { signed: number; pending: number; invalid: number }> = {};
  SIGN_ROLES.forEach((role) => {
    const items = activeSignoffs.value.filter((item) => item.role === role.role);
    map[role.role] = {
      signed: items.filter((item) => item.state === 'signed').length,
      pending: items.filter((item) => item.state === 'pending').length,
      invalid: items.filter((item) => item.state === 'invalid').length
    };
  });
  return map;
});

function resultOf(stepId: string): StepCheck | undefined {
  return active.value?.results.find((item) => item.stepId === stepId);
}

const impactedSteps = computed(() =>
  active.value ? store.steps.filter((step) => active.value!.outcome.impactedIds.includes(step.id)) : []
);
const unaffectedSteps = computed(() =>
  active.value ? store.steps.filter((step) => !active.value!.outcome.impactedIds.includes(step.id)) : []
);
</script>

<template>
  <div class="replace-view">
    <!-- 冻结横幅 -->
    <div v-if="active" class="freeze-banner">
      <q-icon name="ac_unit" />
      <div>
        <strong>方案 V{{ active.freeze.revision }} 已冻结</strong>
        <span>冻结于 {{ active.freeze.frozenAt }} · 基准吊车 {{ active.freeze.craneId }} · 性能表 {{ active.freeze.chartVersion }} · 申请 {{ active.id }}</span>
      </div>
      <q-space />
      <q-badge v-if="active.outcome.status === 'passed'" color="positive" outline>逐项校核通过</q-badge>
      <q-badge v-else color="negative" outline>校核拒绝</q-badge>
    </div>

    <div v-if="store.resumeNotice" class="resume-strip">
      <q-icon name="history_toggle_off" />
      <span>{{ store.resumeNotice }}</span>
      <q-space />
      <q-btn dense flat icon="close" size="12px" @click="store.clearResumeNotice()" />
    </div>

    <q-banner v-if="flash" :class="['flash-banner', flash.kind]" rounded class="bg-white">
      <q-icon :name="flash.kind === 'ok' ? 'check_circle' : 'error_outline'" />
      <span>{{ flash.text }}</span>
    </q-banner>

    <div class="replace-grid">
      <!-- 左列：发起 / 校核过程 -->
      <div class="replace-main">
        <article class="content-panel rp-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">REPLACEMENT REQUEST</span>
              <h2>发起临时换主吊</h2>
            </div>
            <q-btn dense flat no-caps icon="restart_alt" label="重置演示数据" @click="resetDemo" />
          </div>
          <div class="rp-body">
            <div class="current-crane-card">
              <span>方案现行主吊</span>
              <strong>{{ store.currentCrane.model }}</strong>
              <small>{{ store.currentCrane.ratedTon }}t · 配重 {{ store.currentCrane.counterweight }}t · 路基板
                {{ store.currentCrane.padLength }}×{{ store.currentCrane.padWidth }}m · 表 {{ store.currentCrane.chartVersion }}</small>
            </div>
            <div class="rp-form">
              <q-select
                v-model="targetId"
                :options="store.candidateCranes.map(c => ({ label: `${c.model}（${c.ratedTon}t）`, value: c.id }))"
                label="替换吊车（档案型号）"
                outlined dense emit-value map-options
              />
              <div class="form-row">
                <q-input v-model="applicant" outlined dense label="申请人" />
                <q-input v-model="applicantTeam" outlined dense label="所属单位" />
              </div>
              <q-input v-model="note" outlined autogrow label="换吊事由 / 现场说明" />
              <div class="rp-actions">
                <q-btn color="primary" no-caps icon="swap_horiz" label="冻结方案并校核" :disable="!!active || !targetId" @click="submit(false)" />
                <q-btn outline no-caps icon="groups" label="模拟第二人同时申请同机" :disable="!!active || !targetId" @click="submit(true)" />
              </div>
              <p class="rp-hint">规则：发起即冻结方案版本；同一台吊车两人同时提交时先到者生效、后到者保留申请与差异；同一人重复申请不生成第二版。</p>
            </div>
          </div>
        </article>

        <!-- 生效中的替换：确认链 + 结果 -->
        <template v-if="active && targetCrane && fromCrane">
          <article class="content-panel rp-panel">
            <div class="panel-heading">
              <div>
                <span class="panel-kicker">ARCHIVE DIFF</span>
                <h2>吊车档案差异 · {{ active.id }}</h2>
              </div>
              <div class="applicant-chip">{{ active.applicant }} · {{ active.applicantTeam }} · {{ active.submittedAt }}</div>
            </div>
            <div class="diff-table">
              <div v-for="row in active.diff" :key="row.field" class="diff-row">
                <span class="diff-field">{{ row.field }}</span>
                <span class="diff-from">{{ row.from }}</span>
                <q-icon name="arrow_right_alt" />
                <span class="diff-to">{{ row.to }}</span>
              </div>
            </div>
          </article>

          <article class="content-panel rp-panel">
            <div class="panel-heading">
              <div>
                <span class="panel-kicker">STEP-BY-STEP CHECK</span>
                <h2>按步骤作业半径 / 荷载率逐项校核</h2>
              </div>
              <q-badge :color="active.outcome.status === 'passed' ? 'positive' : 'negative'">
                {{ active.outcome.status === 'passed' ? '全部通过' : '已拒绝' }}
              </q-badge>
            </div>
            <p v-if="active.outcome.reason" class="reject-reason"><q-icon name="block" />{{ active.outcome.reason }}</p>
            <div class="result-table">
              <div class="result-head">
                <span>步骤</span><span>半径</span><span>吊重</span><span>额定能力</span><span>荷载率</span>
                <span>支腿反力</span><span>接地压力/地耐力</span><span>结论</span>
              </div>
              <div v-for="result in active.results" :key="result.stepId" class="result-row" :class="{ fail: !result.pass, ground: result.groundFail }">
                <span><strong>{{ result.stepId }}</strong><small>{{ result.title }}</small></span>
                <span>{{ result.radius }}m</span>
                <span>{{ result.requiredLoad }}t</span>
                <span>{{ result.ratedCapacity === null ? '超表' : `${result.ratedCapacity.toFixed(1)}t` }}</span>
                <span :class="{ danger: result.loadRate !== null && result.loadRate > 90 }">{{ pct(result.loadRate) }}<small v-if="result.oldRate !== null">原 {{ pct(result.oldRate) }}</small></span>
                <span>{{ kn(result.reaction) }}</span>
                <span>
                  {{ kpa(result.pressure) }}
                  <small>承载 {{ result.groundCapacity }}kPa · {{ result.padArea.toFixed(2) }}㎡</small>
                </span>
                <span>
                  <q-icon :name="result.pass ? 'check_circle' : result.groundFail ? 'foundation' : 'warning'"
                    :color="result.pass ? 'positive' : result.groundFail ? 'negative' : 'warning'" />
                  <small v-for="(reason, i) in result.reasons" :key="i">{{ reason }}</small>
                </span>
              </div>
            </div>
          </article>

          <article class="content-panel rp-panel">
            <div class="panel-heading">
              <div>
                <span class="panel-kicker">AFFECTED STEPS</span>
                <h2>受影响步骤（{{ impactedSteps.length }}）与照旧步骤（{{ unaffectedSteps.length }}）</h2>
              </div>
            </div>
            <div class="affected-wrap">
              <div class="affected-col">
                <h3>受影响，必须重算 / 重签</h3>
                <q-chip v-for="step in impactedSteps" :key="step.id" square color="deep-orange-2" text-color="deep-orange-9"
                  :icon="active.outcome.failedIds.includes(step.id) ? 'error' : 'autorenew'" @click="store.selectStep(step.id)">
                  {{ step.id }} {{ step.title }}
                </q-chip>
              </div>
              <div class="affected-col muted-col">
                <h3>其他步骤照旧</h3>
                <q-chip v-for="step in unaffectedSteps" :key="step.id" square color="grey-3" text-color="grey-8" icon="lock_clock">
                  {{ step.id }} {{ step.title }}
                </q-chip>
              </div>
            </div>
          </article>

          <article class="content-panel rp-panel">
            <div class="panel-heading">
              <div>
                <span class="panel-kicker">CHECKLIST & RESUME</span>
                <h2>确认链（中断 / 导出保存后从最后确认项续作）</h2>
              </div>
              <div class="resume-state">
                已确认 {{ store.resumeInfo?.done ?? 0 }}/{{ store.resumeInfo?.total ?? 6 }}
              </div>
            </div>
            <div class="check-chain">
              <div v-for="(check, index) in active.checks" :key="check.key" class="check-node" :class="{ done: check.confirmed, blocked: !check.confirmed && active.checks.slice(0, index).some(c => !c.confirmed) }">
                <div class="check-index">{{ check.confirmed ? '✓' : index + 1 }}</div>
                <div class="check-copy">
                  <strong>{{ check.label }}</strong>
                  <span>{{ check.hint }}</span>
                  <small v-if="check.confirmedAt">{{ check.confirmedBy }} 于 {{ check.confirmedAt }} 确认</small>
                </div>
                <q-btn v-if="!check.confirmed" dense no-caps color="primary" unelevated label="确认" @click="confirmKey(check.key)" />
                <q-icon v-else name="verified" color="positive" size="22px" />
              </div>
            </div>
            <div class="rp-footer-actions">
              <q-btn color="positive" no-caps icon="task_alt" label="接受替换并升版"
                :disable="active.outcome.status === 'rejected' || active.checks.some(c => !c.confirmed)" @click="accept" />
              <q-btn outline color="negative" no-caps icon="do_not_disturb_on" label="拒绝并归档" @click="reject" />
              <q-btn flat no-caps icon="undo" label="撤回申请" @click="withdraw(active.id)" />
            </div>
          </article>
        </template>

        <!-- 无生效申请时的空态 -->
        <article v-else-if="!active" class="content-panel rp-panel empty-panel">
          <q-icon name="construction" size="40px" color="grey-5" />
          <h2>当前没有生效中的换吊校核</h2>
          <p>选择替换吊车发起申请，系统会冻结当前方案版本，逐项查起重性能表并比对支腿反力与地基承载力。</p>
        </article>
      </div>

      <!-- 右列：会签 / 保留申请 / 档案 -->
      <aside class="replace-side">
        <article v-if="active" class="content-panel rp-panel">
          <div class="panel-heading compact side-heading">
            <div>
              <span class="panel-kicker">ROLE SIGN-OFF</span>
              <h2>对应角色会签</h2>
            </div>
          </div>
          <div class="sign-summary">
            <div v-for="role in SIGN_ROLES" :key="role.role" class="sign-role-row">
              <div>
                <strong>{{ role.role }} · {{ role.person }}</strong>
                <span>{{ role.scope }}</span>
              </div>
              <div class="sign-counts">
                <q-badge color="positive">{{ signRoleState[role.role]?.signed ?? 0 }} 签</q-badge>
                <q-badge v-if="signRoleState[role.role]?.pending" color="grey">{{ signRoleState[role.role]?.pending }} 待</q-badge>
                <q-badge v-if="signRoleState[role.role]?.invalid" color="negative">{{ signRoleState[role.role]?.invalid }} 失效</q-badge>
              </div>
            </div>
          </div>
          <div class="sign-form">
            <q-input v-model="signPerson.name" outlined dense label="签署人（默认档案责任人）" />
            <q-input v-model="signPerson.opinion" outlined dense autogrow label="签署意见" />
          </div>
          <q-select v-model="signRoleFilter" outlined dense dense-options label="只看角色"
            :options="[{ label: '全部角色', value: 'all' }, ...SIGN_ROLES.map(r => ({ label: r.role, value: r.role }))]"
            emit-value map-options class="sign-filter" />
          <div class="sign-matrix">
            <template v-for="role in SIGN_ROLES" :key="role.role">
              <div v-if="signRoleFilter === 'all' || signRoleFilter === role.role" v-for="stepId in active.outcome.impactedIds"
                :key="`${role.role}-${stepId}`" class="sign-cell" :class="signState(active.id, role.role, stepId)?.state">
                <span>{{ role.role }} / {{ stepId }}</span>
                <q-btn v-if="signState(active.id, role.role, stepId)?.state !== 'signed'" dense no-caps size="12px"
                  :color="signState(active.id, role.role, stepId)?.state === 'invalid' ? 'negative' : 'primary'"
                  :label="signState(active.id, role.role, stepId)?.state === 'invalid' ? '失效重签' : '签署'"
                  @click="sign(role.role, stepId)" />
                <span v-else class="signed-ok"><q-icon name="done_all" color="positive" size="14px" />已签</span>
                <small v-if="signState(active.id, role.role, stepId)?.invalidReason" class="invalid-reason">
                  {{ signState(active.id, role.role, stepId)?.invalidReason }}
                </small>
              </div>
            </template>
          </div>
        </article>

        <article class="content-panel rp-panel">
          <div class="panel-heading compact side-heading">
            <div>
              <span class="panel-kicker">CONCURRENT</span>
              <h2>并发与保留申请（{{ store.retainedRequests.length }}）</h2>
            </div>
          </div>
          <div v-if="store.retainedRequests.length === 0" class="side-empty">暂无后到申请。</div>
          <div v-for="req in store.retainedRequests" :key="req.id" class="retained-card">
            <div class="retained-head">
              <strong>{{ req.id }}</strong>
              <q-badge color="deep-orange">保留</q-badge>
            </div>
            <p>{{ req.applicant }}（{{ req.applicantTeam }}）申请换用 {{ req.targetCraneId }}，{{ req.submittedAt }}</p>
            <div v-if="req.retained" class="retained-diff">
              <div v-for="d in req.retained.diff" :key="d.field" class="mini-diff">
                <span>{{ d.field }}</span>
                <small>{{ d.from }} → {{ d.to }}</small>
              </div>
            </div>
            <div class="retained-actions">
              <q-btn dense no-caps outline color="primary" label="先到关闭后转生效" @click="promote(req.id)" />
              <q-btn dense flat no-caps label="撤回" @click="withdraw(req.id)" />
            </div>
          </div>
        </article>

        <article class="content-panel rp-panel">
          <div class="panel-heading compact side-heading">
            <div>
              <span class="panel-kicker">ARCHIVE EDIT</span>
              <h2>吊车档案 / 步骤参数变更</h2>
            </div>
          </div>
          <p class="side-note">档案或步骤参数一变，关联步骤、冲突与对应角色签署立即失效重算，其他步骤照旧；旧步骤无快照时在发起替换时先备份当前值。</p>
          <q-select v-model="editingCraneId" outlined dense emit-value map-options
            :options="store.cranes.map((c) => ({ label: c.model, value: c.id }))" label="选择吊车档案" />
          <div class="archive-grid">
            <q-input :model-value="editingCrane.model" outlined dense label="型号" readonly />
            <q-input :model-value="editingCrane.chartVersion" outlined dense label="性能表版本" readonly />
            <q-input :model-value="editingCrane.counterweight" type="number" outlined dense label="配重 t"
              @update:model-value="num((v) => updateArchive({ counterweight: v }))" />
            <q-input :model-value="editingCrane.padLength" type="number" outlined dense label="路基板长 m"
              @update:model-value="num((v) => updatePad('padLength', v))" />
            <q-input :model-value="editingCrane.padWidth" type="number" outlined dense label="路基板宽 m"
              @update:model-value="num((v) => updatePad('padWidth', v))" />
          </div>
          <q-btn class="bump-chart" dense no-caps outline color="primary" icon="published_with_changes"
            label="模拟性能表换版（失效设备/方案签署）" @click="bumpChartVersion" />

          <div class="step-quick">
            <h3>步骤参数（改动即重算）</h3>
            <q-select v-model="store.selectedStepId" outlined dense emit-value map-options
              :options="store.steps.map((s) => ({ label: `${s.id} ${s.title}`, value: s.id }))" label="选择步骤" />
            <div class="archive-grid">
              <q-input :model-value="store.selectedStep.radius" type="number" outlined dense label="半径 m"
                @update:model-value="num((v) => store.updateStep({ radius: v }))" />
              <q-input :model-value="store.selectedStep.loadWeight" type="number" outlined dense label="吊重 t"
                @update:model-value="num((v) => store.updateStep({ loadWeight: v }))" />
              <q-input :model-value="store.selectedStep.groundCapacity" type="number" outlined dense label="地耐力 kPa"
                @update:model-value="num((v) => store.updateStep({ groundCapacity: v }))" />
              <q-input :model-value="store.selectedStep.boom" type="number" outlined dense label="臂长 m"
                @update:model-value="num((v) => store.updateStep({ boom: v }))" />
            </div>
            <div v-if="store.selectedStep.snapshot" class="snapshot-chip" :class="{ stale: store.selectedStep.snapshot.stale }">
              <q-icon :name="store.selectedStep.snapshot.stale ? 'sync_problem' : 'camera_alt'" />
              <span>
                设备快照：{{ store.selectedStep.snapshot.craneModel }} · {{ store.selectedStep.snapshot.chartVersion }}
                <template v-if="store.selectedStep.snapshot.backup">
                  <br />已备份旧值：荷载率 {{ store.selectedStep.snapshot.backup.loadRate }}% / 半径
                  {{ store.selectedStep.snapshot.backup.radius }}m（{{ store.selectedStep.snapshot.backup.reason }}）
                </template>
              </span>
            </div>
          </div>
        </article>

        <article v-if="store.historyRequests.length" class="content-panel rp-panel">
          <div class="panel-heading compact side-heading">
            <div>
              <span class="panel-kicker">HISTORY</span>
              <h2>历史申请（每台设备仅一版生效）</h2>
            </div>
          </div>
          <div v-for="req in store.historyRequests.slice(0, 6)" :key="req.id" class="history-row">
            <q-icon :name="req.status === 'accepted' ? 'task_alt' : req.status === 'rejected' ? 'block' : 'label_off'"
              :color="req.status === 'accepted' ? 'positive' : req.status === 'rejected' ? 'negative' : 'grey'" />
            <div>
              <strong>{{ req.id }} · {{ req.applicant }}</strong>
              <small>{{ req.fromCraneId }} → {{ req.targetCraneId }} · {{ req.submittedAt }} · {{ STATUS_LABEL[req.status] ?? req.status }}</small>
            </div>
          </div>
        </article>
      </aside>
    </div>
  </div>
</template>
