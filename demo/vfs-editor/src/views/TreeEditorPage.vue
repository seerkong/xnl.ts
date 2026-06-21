<template>
  <div class="editor" v-loading="loading">
    <div class="toolbar">
      <el-button @click="$router.push('/')">← 返回</el-button>
      <el-button type="primary" @click="onSave">保存 (commit)</el-button>
      <el-button @click="openHistory">历史</el-button>
      <span v-if="dirty" class="dirty">● 未保存</span>
    </div>
    <div class="body">
      <div class="left">
        <VfsEditor
          :modelValue="currentNodes"
          height="100%"
          @request-create-folder="onCreateFolder"
          @request-create-file="onCreateFile"
          @request-edit-node="onEdit"
          @request-delete-node="onDelete"
          @node-move="onMove"
          @node-dblclick="onOpen"
        />
      </div>
      <div class="right">
        <template v-if="editing">
          <div class="right-head">{{ editing.path }}</div>
          <el-input v-model="content" type="textarea" :rows="22" resize="none" />
          <div class="right-actions">
            <el-button type="primary" @click="applyContent">应用内容</el-button>
            <el-button @click="editing = null">关闭</el-button>
          </div>
        </template>
        <el-empty v-else description="双击文件以编辑内容" />
      </div>
    </div>

    <el-drawer v-model="showHistory" title="提交历史" size="360px">
      <el-timeline v-if="commits.length">
        <el-timeline-item v-for="c in commits" :key="c.id" :timestamp="c.timestamp">
          <div>{{ c.message }}</div>
          <div class="commit-meta">{{ c.author }} · {{ c.id.slice(0, 8) }}</div>
          <el-button size="small" @click="onCheckout(c.id)">检出</el-button>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="还没有提交" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessageBox, ElMessage } from "element-plus";
import { VfsEditor, type VfsNode } from "xnl-vfs-editor";
import type { LogEntry } from "xnl-vcs";
import { useStore } from "../store";

const props = defineProps<{ id: string }>();
const store = useStore();
const { currentNodes, loading, dirty } = store;

const editing = ref<VfsNode | null>(null);
const content = ref("");
const showHistory = ref(false);
const commits = ref<LogEntry[]>([]);

onMounted(() => store.selectTree(props.id));

async function promptName(title: string, value = ""): Promise<string | null> {
  try {
    const r = await ElMessageBox.prompt(title, title, {
      inputValue: value,
      inputPattern: /\S+/,
      inputErrorMessage: "不能为空",
    });
    return r.value;
  } catch {
    return null;
  }
}

async function onCreateFolder(parentId: string | null) {
  const name = await promptName("新建文件夹");
  if (name) store.createFolder(name, parentId);
}

async function onCreateFile(parentId: string | null) {
  const name = await promptName("新建文件");
  if (name) store.createFile(name, parentId, "");
}

async function onEdit(node: VfsNode) {
  if (node.type === "directory") {
    const name = await promptName("重命名", node.name);
    if (name && name !== node.name) store.renameNode(node.id, name);
  } else {
    onOpen(node);
  }
}

function onDelete(node: VfsNode) {
  ElMessageBox.confirm(`删除「${node.name}」？`, "确认", { type: "warning" })
    .then(() => {
      store.deleteNode(node.id);
      if (editing.value?.id === node.id) editing.value = null;
    })
    .catch(() => {});
}

function onMove(e: { nodeId: string; newParentId: string | null }) {
  store.moveNode(e.nodeId, e.newParentId);
}

function onOpen(node: VfsNode) {
  if (node.type !== "file") return;
  editing.value = node;
  const cfg = node.sourceConfig as { content?: string } | undefined;
  content.value = cfg?.content ?? "";
}

function applyContent() {
  if (!editing.value) return;
  store.updateNodeContent(editing.value.id, content.value);
  ElMessage.success("内容已应用（记得保存提交）");
}

async function onSave() {
  const msg = await promptName("提交说明", "update");
  if (!msg) return;
  const id = await store.save(msg);
  ElMessage.success(id ? `已提交 ${id.slice(0, 8)}` : "已提交");
}

function openHistory() {
  commits.value = store.history();
  showHistory.value = true;
}

async function onCheckout(id: string) {
  await store.checkout(id);
  showHistory.value = false;
  editing.value = null;
  ElMessage.success("已检出该版本");
}
</script>

<style scoped>
.editor { display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #e4e7ed; }
.dirty { color: #e6a23c; font-size: 12px; }
.body { flex: 1; min-height: 0; display: flex; }
.left { flex: 1; min-width: 0; border-right: 1px solid #e4e7ed; }
.right { width: 420px; display: flex; flex-direction: column; padding: 12px; gap: 8px; }
.right-head { font-family: monospace; font-size: 12px; color: #606266; word-break: break-all; }
.right-actions { display: flex; gap: 8px; }
.commit-meta { font-size: 12px; color: #909399; margin: 2px 0 6px; }
</style>
