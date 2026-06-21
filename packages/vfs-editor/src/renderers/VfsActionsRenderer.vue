<template>
  <div class="vfs-actions-renderer">
    <el-button
      v-if="!readonly"
      :icon="Edit"
      link
      type="primary"
      size="small"
      @click="handleEdit"
    >
      编辑
    </el-button>
    <el-button
      v-if="!readonly"
      :icon="Delete"
      link
      type="danger"
      size="small"
      @click="handleDelete"
    >
      删除
    </el-button>
    <span v-if="readonly" class="readonly-text">只读</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ICellRendererParams } from 'ag-grid-community'
import { Edit, Delete } from '@element-plus/icons-vue'
import type { VfsNode } from '../types'

interface TreeDataNode extends VfsNode {
  orgHierarchy: string[]
}

interface CellRendererParams extends ICellRendererParams<TreeDataNode> {
  readonly?: boolean
  onEdit?: (node: VfsNode) => void
  onDelete?: (node: VfsNode) => void
}

interface Props {
  params: CellRendererParams
}

const props = defineProps<Props>()

/**
 * 是否只读
 */
const readonly = computed(() => props.params.readonly ?? false)

/**
 * 节点数据
 */
const nodeData = computed(() => props.params.data)

/**
 * 处理编辑
 */
function handleEdit() {
  if (nodeData.value && props.params.onEdit) {
    props.params.onEdit(nodeData.value)
  }
}

/**
 * 处理删除
 */
function handleDelete() {
  if (nodeData.value && props.params.onDelete) {
    props.params.onDelete(nodeData.value)
  }
}
</script>

<style scoped>
.vfs-actions-renderer {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.readonly-text {
  color: #909399;
  font-size: 12px;
}
</style>
