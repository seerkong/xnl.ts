<template>
  <div class="vfs-name-renderer" :style="{ paddingLeft: `${indentPx}px` }">
    <!-- 展开/折叠 chevron（仅目录显示，文件留出等宽占位以对齐） -->
    <span
      class="vfs-name-chevron"
      :class="{ 'is-clickable': isDirectory }"
      @click="handleToggle"
    >
      <el-icon v-if="isDirectory">
        <ArrowDown v-if="isExpanded" />
        <ArrowRight v-else />
      </el-icon>
    </span>

    <el-icon class="vfs-name-icon" :class="iconClass">
      <component :is="iconComponent" />
    </el-icon>
    <span class="vfs-name-text">{{ displayName }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ICellRendererParams } from 'ag-grid-community'
import {
  Folder,
  FolderOpened,
  Document,
  DocumentCopy,
  Link,
  Tickets,
  ArrowDown,
  ArrowRight
} from '@element-plus/icons-vue'
import type { VfsNode, VfsSourceType } from '../types'

/**
 * 行数据：节点 + 树渲染所需的视图字段（深度 / 是否展开 / 是否目录）。
 * 由 VfsEditor 自算可见行时注入。
 */
interface VfsRowNode extends VfsNode {
  _depth: number
  _expanded: boolean
  _hasChildren: boolean
}

/**
 * 自定义 cellRendererParams：community 模式下树交互通过回调上抛给 VfsEditor。
 */
interface NameCellRendererParams extends ICellRendererParams<VfsRowNode> {
  onToggle?: (nodeId: string) => void
}

interface Props {
  params: NameCellRendererParams
}

const props = defineProps<Props>()

/**
 * 节点数据
 */
const nodeData = computed(() => props.params.data)

/**
 * 是否为目录
 */
const isDirectory = computed(() => nodeData.value?.type === 'directory')

/**
 * 是否为展开状态（来自自算视图字段）
 */
const isExpanded = computed(() => nodeData.value?._expanded ?? false)

/**
 * 缩进像素：按深度计算（每层 16px）
 */
const indentPx = computed(() => (nodeData.value?._depth ?? 0) * 16)

/**
 * 显示名称
 */
const displayName = computed(() => nodeData.value?.name || '')

/**
 * 图标组件
 */
const iconComponent = computed(() => {
  if (!nodeData.value) return Document

  if (nodeData.value.type === 'directory') {
    return isExpanded.value ? FolderOpened : Folder
  }

  // 根据来源类型选择文件图标
  const sourceType = nodeData.value.sourceType as VfsSourceType | undefined
  switch (sourceType) {
    case 'static':
      return Document
    case 'online-docs':
      return Link
    case 'prompt-service':
      return Tickets
    default:
      return DocumentCopy
  }
})

/**
 * 图标样式类
 */
const iconClass = computed(() => {
  if (!nodeData.value) return ''

  if (nodeData.value.type === 'directory') {
    return 'vfs-icon-directory'
  }

  const sourceType = nodeData.value.sourceType as VfsSourceType | undefined
  switch (sourceType) {
    case 'static':
      return 'vfs-icon-static'
    case 'online-docs':
      return 'vfs-icon-online-docs'
    case 'prompt-service':
      return 'vfs-icon-prompt-service'
    default:
      return 'vfs-icon-file'
  }
})

/**
 * 点击 chevron 切换展开/折叠（仅目录有效）
 */
function handleToggle(event: MouseEvent) {
  if (!isDirectory.value || !nodeData.value) return
  // 阻止冒泡，避免触发行选中/双击
  event.stopPropagation()
  props.params.onToggle?.(nodeData.value.id)
}
</script>

<style scoped>
.vfs-name-renderer {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.vfs-name-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
  color: #909399;
}

.vfs-name-chevron.is-clickable {
  cursor: pointer;
}

.vfs-name-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.vfs-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 目录图标 - 黄色 */
.vfs-icon-directory {
  color: #e6a23c;
}

/* 静态字符串文件 - 蓝色 */
.vfs-icon-static {
  color: #409eff;
}

/* 在线文档 - 绿色 */
.vfs-icon-online-docs {
  color: #67c23a;
}

/* 提示词服务 - 紫色 */
.vfs-icon-prompt-service {
  color: #a855f7;
}

/* 默认文件 - 灰色 */
.vfs-icon-file {
  color: #909399;
}
</style>
