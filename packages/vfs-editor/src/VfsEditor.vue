<template>
  <div class="vfs-editor">
    <!-- 工具栏 -->
    <div class="vfs-editor-toolbar">
      <slot name="toolbar">
        <el-button-group>
          <el-button :icon="FolderAdd" @click="handleCreateFolder" :disabled="readonly">
            新建文件夹
          </el-button>
          <el-button :icon="DocumentAdd" @click="handleCreateFile" :disabled="readonly">
            新建文件
          </el-button>
        </el-button-group>
        <el-button-group>
          <el-button :icon="Expand" @click="expandAll">展开全部</el-button>
          <el-button :icon="Fold" @click="collapseAll">折叠全部</el-button>
          <el-button
            :icon="Download"
            @click="handleExportZip"
            :loading="isExporting"
            :title="selectedNode ? '导出选中节点' : '导出整个文件系统'"
          >
            导出{{ selectedNode ? '选中' : '全部' }}
          </el-button>
        </el-button-group>
      </slot>
    </div>

    <!-- AG Grid 表格（community：自算可见行，无 treeData/getDataPath） -->
    <div class="vfs-editor-grid" :style="{ height: gridHeight }">
      <ag-grid-vue
        class="ag-theme-alpine"
        style="height: 100%; width: 100%;"
        theme="legacy"
        :columnDefs="columnDefs"
        :rowData="visibleRows"
        :defaultColDef="defaultColDef"
        :getRowId="getRowId"
        :rowSelection="'single'"
        :suppressRowClickSelection="false"
        :rowDragManaged="false"
        :animateRows="true"
        @grid-ready="onGridReady"
        @selection-changed="onSelectionChanged"
        @row-double-clicked="onRowDoubleClicked"
        @row-drag-end="onRowDragEnd"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import {
  ModuleRegistry,
  AllCommunityModule,
  type GridApi,
  type ColDef,
  type GridReadyEvent,
  type SelectionChangedEvent,
  type RowDoubleClickedEvent,
  type RowDragEndEvent,
  type GetRowIdParams
} from 'ag-grid-community'
import {
  FolderAdd,
  DocumentAdd,
  Expand,
  Fold,
  Download
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
// community 主题样式（legacy CSS 模式）；仅 community 包，无私有付费模块 import
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'

import type { VfsNode, VfsSourceType } from './types'
import { SOURCE_TYPE_OPTIONS } from './types'
import { useVfsTree } from './composables/useVfsTree'
import { useZipExport } from './composables/useZipExport'
import VfsNameRenderer from './renderers/VfsNameRenderer.vue'
import VfsActionsRenderer from './renderers/VfsActionsRenderer.vue'

// ag-grid v33+ 需要显式注册模块（community 全量模块）
ModuleRegistry.registerModules([AllCommunityModule])

// ============================================
// 行视图类型（节点 + 树渲染字段）
// ============================================

/**
 * 可见行：在 VfsNode 基础上注入树渲染所需的视图字段。
 * _depth：缩进层级；_expanded：自身是否展开（仅目录有意义）；
 * _hasChildren：是否有子节点（用于决定是否画 chevron）。
 */
interface VfsRowNode extends VfsNode {
  _depth: number
  _expanded: boolean
  _hasChildren: boolean
}

// ============================================
// Props & Emits
// ============================================

interface Props {
  /** 虚拟文件系统数据 */
  modelValue: VfsNode[]

  /** 是否只读模式 */
  readonly?: boolean

  /** 高度 */
  height?: string | number

  /** 允许的来源类型 */
  allowedSourceTypes?: VfsSourceType[]

  /** 是否允许拖拽排序 */
  draggable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  readonly: false,
  height: 400,
  allowedSourceTypes: () => ['static', 'online-docs', 'prompt-service'],
  draggable: true
})

const emit = defineEmits<{
  /** 数据变更 */
  (e: 'update:modelValue', value: VfsNode[]): void
  /** 节点选中 */
  (e: 'node-select', node: VfsNode | null): void
  /** 节点双击 */
  (e: 'node-dblclick', node: VfsNode): void
  /** 节点创建 */
  (e: 'node-create', node: VfsNode): void
  /** 节点更新 */
  (e: 'node-update', node: VfsNode): void
  /** 节点删除 */
  (e: 'node-delete', nodeId: string): void
  /** 请求创建文件夹 */
  (e: 'request-create-folder', parentId: string | null): void
  /** 请求创建文件 */
  (e: 'request-create-file', parentId: string | null): void
  /** 请求编辑节点 */
  (e: 'request-edit-node', node: VfsNode): void
  /** 请求删除节点 */
  (e: 'request-delete-node', node: VfsNode): void
  /** 节点移动 */
  (e: 'node-move', data: { nodeId: string; newParentId: string | null; newIndex: number }): void
}>()

// `emit` 仅部分事件在本组件内触发，其余为受控契约对外暴露的接口。
void emit

// ============================================
// Refs
// ============================================

const gridApi = ref<GridApi<VfsRowNode> | null>(null)
const selectedNode = ref<VfsNode | null>(null)

/** 已展开目录 id 集合（默认全展开，见 watch modelValue） */
const expanded = ref<Set<string>>(new Set())

// ============================================
// Composables
// ============================================

const nodesRef = computed(() => props.modelValue)
const { sortNodes } = useVfsTree({ nodes: nodesRef })
const { exportToZip } = useZipExport(nodesRef)
const isExporting = ref(false)

// ============================================
// Computed
// ============================================

const gridHeight = computed(() => {
  if (typeof props.height === 'number') {
    return `${props.height}px`
  }
  return props.height
})

/**
 * 全部目录 id（用于"默认全展开"与"展开全部"）
 */
const allDirectoryIds = computed(() =>
  props.modelValue.filter(n => n.type === 'directory').map(n => n.id)
)

/**
 * 按 parentId 分组的子节点（已排序：目录在前、同类型按名称）。
 */
const childrenByParent = computed(() => {
  const map = new Map<string | null, VfsNode[]>()
  for (const node of props.modelValue) {
    const key = node.parentId
    const arr = map.get(key)
    if (arr) arr.push(node)
    else map.set(key, [node])
  }
  for (const [key, arr] of map) {
    map.set(key, sortNodes(arr))
  }
  return map
})

/**
 * 自算可见行：从根开始按树序深度遍历；折叠的目录隐藏其后代。
 */
const visibleRows = computed<VfsRowNode[]>(() => {
  const rows: VfsRowNode[] = []
  const byParent = childrenByParent.value

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? []
    for (const node of children) {
      const hasChildren = (byParent.get(node.id)?.length ?? 0) > 0
      const isExpanded = expanded.value.has(node.id)
      rows.push({
        ...node,
        _depth: depth,
        _expanded: isExpanded,
        _hasChildren: hasChildren
      })
      // 目录展开时递归其子节点
      if (node.type === 'directory' && isExpanded) {
        walk(node.id, depth + 1)
      }
    }
  }

  walk(null, 0)
  return rows
})

// ============================================
// AG Grid 配置
// ============================================

const getRowId = (params: GetRowIdParams<VfsRowNode>) => params.data.id

function toggleNode(nodeId: string) {
  const next = new Set(expanded.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  expanded.value = next
}

const columnDefs = computed<ColDef<VfsRowNode>[]>(() => [
  {
    headerName: '名称',
    field: 'name',
    minWidth: 300,
    flex: 2,
    sortable: false,
    // community 行拖拽（非 managed），由 onRowDragEnd 计算新父节点
    rowDrag: !props.readonly && props.draggable,
    cellRenderer: VfsNameRenderer,
    cellRendererParams: {
      onToggle: toggleNode
    }
  },
  {
    field: 'type',
    headerName: '类型',
    width: 100,
    valueFormatter: (params) => (params.value === 'directory' ? '目录' : '文件')
  },
  {
    field: 'sourceType',
    headerName: '来源类型',
    width: 120,
    valueFormatter: (params) => {
      if (!params.value) return '-'
      const option = SOURCE_TYPE_OPTIONS.find(o => o.value === params.value)
      return option?.label || params.value
    }
  },
  {
    field: 'cached',
    headerName: '缓存',
    width: 80,
    valueFormatter: (params) => (params.value ? '是' : '否')
  },
  {
    headerName: '操作',
    width: 150,
    cellRenderer: VfsActionsRenderer,
    cellRendererParams: {
      readonly: props.readonly,
      onEdit: (node: VfsNode) => emit('request-edit-node', node),
      onDelete: (node: VfsNode) => emit('request-delete-node', node)
    }
  }
])

const defaultColDef = ref<ColDef>({
  flex: 1,
  sortable: true,
  resizable: true
})

// ============================================
// Event Handlers
// ============================================

function onGridReady(event: GridReadyEvent<VfsRowNode>) {
  gridApi.value = event.api
  event.api.sizeColumnsToFit()
}

function onSelectionChanged(event: SelectionChangedEvent<VfsRowNode>) {
  const rows = event.api.getSelectedRows()
  selectedNode.value = rows[0] || null
  emit('node-select', selectedNode.value)
}

function onRowDoubleClicked(event: RowDoubleClickedEvent<VfsRowNode>) {
  if (event.data) {
    emit('node-dblclick', event.data)
  }
}

function onRowDragEnd(event: RowDragEndEvent<VfsRowNode>) {
  if (!event.node.data || props.readonly) return

  const draggedNode = event.node.data
  const overNode = event.overNode?.data

  // 确定新的父节点
  let newParentId: string | null = null

  if (overNode) {
    // 如果放在目录上，则移动到该目录下
    if (overNode.type === 'directory') {
      newParentId = overNode.id
    } else {
      // 如果放在文件上，则移动到该文件的父目录
      newParentId = overNode.parentId
    }
  }

  // 不能移动到自己上 / 自己的子树下（无效操作）
  if (newParentId === draggedNode.id) return
  if (newParentId !== null && isDescendant(newParentId, draggedNode.id)) return

  // 获取新的排序位置
  const newIndex = event.overIndex ?? 0

  // community 不做 managed 移动，仅上抛 node-move 由父层处理数据
  emit('node-move', {
    nodeId: draggedNode.id,
    newParentId,
    newIndex
  })
}

/**
 * 判断 candidateId 是否为 ancestorId 的后代（防止把目录拖进自己的子树）
 */
function isDescendant(candidateId: string, ancestorId: string): boolean {
  let current: VfsNode | undefined = props.modelValue.find(n => n.id === candidateId)
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true
    current = props.modelValue.find(n => n.id === current!.parentId)
  }
  return false
}

// ============================================
// Toolbar Actions
// ============================================

function handleCreateFolder() {
  const parentId = selectedNode.value?.type === 'directory'
    ? selectedNode.value.id
    : selectedNode.value?.parentId || null
  emit('request-create-folder', parentId)
}

function handleCreateFile() {
  const parentId = selectedNode.value?.type === 'directory'
    ? selectedNode.value.id
    : selectedNode.value?.parentId || null
  emit('request-create-file', parentId)
}

/** 展开全部：填充全部目录 id */
function expandAll() {
  expanded.value = new Set(allDirectoryIds.value)
}

/** 折叠全部：清空 expanded */
function collapseAll() {
  expanded.value = new Set()
}

function handleExportZip() {
  if (isExporting.value) return
  isExporting.value = true

  const targetNode = selectedNode.value || undefined
  const targetName = targetNode
    ? (targetNode.name.length > 10 ? targetNode.name.slice(0, 10) + '...' : targetNode.name)
    : '全部文件'

  exportToZip(targetNode)
    .then(() => {
      ElMessage.success(`导出 ${targetName} 成功`)
    })
    .catch((err) => {
      console.error(err)
      ElMessage.error('导出失败')
    })
    .finally(() => {
      isExporting.value = false
    })
}

// ============================================
// Exposed Methods
// ============================================

function getSelectedNode(): VfsNode | null {
  return selectedNode.value
}

function scrollToNode(nodeId: string) {
  if (!gridApi.value) return
  // 先确保目标节点的所有祖先目录展开，使其落入可见行
  ensureAncestorsExpanded(nodeId)
  gridApi.value.forEachNode(node => {
    if (node.data?.id === nodeId) {
      gridApi.value?.ensureNodeVisible(node, 'middle')
      node.setSelected(true)
    }
  })
}

/** 展开目标节点的所有祖先目录 */
function ensureAncestorsExpanded(nodeId: string) {
  const target = props.modelValue.find(n => n.id === nodeId)
  if (!target) return
  const next = new Set(expanded.value)
  let current: VfsNode | undefined = target
  while (current && current.parentId) {
    next.add(current.parentId)
    current = props.modelValue.find(n => n.id === current!.parentId)
  }
  expanded.value = next
}

function refresh() {
  gridApi.value?.refreshCells({ force: true })
}

function clearSelection() {
  gridApi.value?.deselectAll()
  selectedNode.value = null
  emit('node-select', null)
}

defineExpose({
  getSelectedNode,
  expandAll,
  collapseAll,
  scrollToNode,
  refresh,
  clearSelection
})

// ============================================
// Watch & Lifecycle
// ============================================

// 数据装载时默认全展开（仅在节点集合变化后补齐新目录的展开态，
// 保留用户已有的折叠操作不强制重置）
let initialized = false
watch(
  () => props.modelValue,
  () => {
    if (!initialized) {
      expanded.value = new Set(allDirectoryIds.value)
      initialized = props.modelValue.length > 0
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.vfs-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.vfs-editor-toolbar {
  display: flex;
  gap: 16px;
  padding: 12px;
  background-color: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
}

.vfs-editor-grid {
  flex: 1;
  min-height: 0;
}

/* 拖拽时的样式 */
:deep(.ag-row-drag) {
  cursor: grab;
}

:deep(.ag-row-dragging) {
  opacity: 0.5;
}
</style>
