<template>
  <div class="tree-list">
    <div class="bar">
      <el-button type="primary" @click="onCreate">新建目录树</el-button>
    </div>
    <el-table v-if="trees.length" :data="trees" @row-click="open" style="cursor: pointer">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="createdAt" label="创建时间" width="220" />
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button size="small" @click.stop="open(row)">打开</el-button>
          <el-button size="small" type="danger" @click.stop="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else description="还没有目录树，点击「新建目录树」开始" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import type { VfsTree } from "xnl-vfs-editor";
import { useStore } from "../store";

const store = useStore();
const { trees } = store;
const router = useRouter();

onMounted(() => store.loadTrees());

async function onCreate() {
  try {
    const { value } = await ElMessageBox.prompt("目录树名称", "新建目录树", {
      inputPattern: /\S+/,
      inputErrorMessage: "名称不能为空",
    });
    const tree = store.createTree({ name: value });
    router.push(`/tree/${tree.id}`);
  } catch {
    /* cancelled */
  }
}

function open(tree: VfsTree) {
  router.push(`/tree/${tree.id}`);
}

function remove(tree: VfsTree) {
  ElMessageBox.confirm(`删除目录树「${tree.name}」？`, "确认", { type: "warning" })
    .then(() => store.deleteTree(tree.id))
    .catch(() => {});
}
</script>

<style scoped>
.tree-list { padding: 16px; }
.bar { margin-bottom: 12px; }
</style>
