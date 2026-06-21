/**
 * useVfsTree - 树形数据处理 Composable
 * 处理 VfsNode 数据与 AG Grid Tree Data 格式之间的转换
 */

import { computed, type Ref } from 'vue'
import type { VfsNode } from '../types'

/**
 * AG Grid Tree Data 所需的扩展节点类型
 */
export interface TreeDataNode extends VfsNode {
  /** AG Grid Tree Data 使用的路径数组 */
  orgHierarchy: string[]
}

/**
 * useVfsTree composable 参数
 */
export interface UseVfsTreeOptions {
  /** 原始节点数据 */
  nodes: Ref<VfsNode[]>
}

/**
 * 树形数据处理 Composable
 */
export function useVfsTree(options: UseVfsTreeOptions) {
  const { nodes } = options

  /**
   * 将扁平节点数据转换为 AG Grid Tree Data 格式
   * 每个节点添加 orgHierarchy 数组用于树形展示
   */
  const treeData = computed<TreeDataNode[]>(() => {
    return sortNodes(nodes.value).map(node => ({
      ...node,
      orgHierarchy: pathToHierarchy(node.path)
    }))
  })

  /**
   * 将路径字符串转换为层级数组
   * @example "/prompts/system/base.md" => ["prompts", "system", "base.md"]
   */
  function pathToHierarchy(path: string): string[] {
    return path.split('/').filter(Boolean)
  }

  /**
   * 根据层级数组计算完整路径
   * @example ["prompts", "system", "base.md"] => "/prompts/system/base.md"
   */
  function hierarchyToPath(hierarchy: string[]): string {
    return '/' + hierarchy.join('/')
  }

  /**
   * 对节点进行排序
   * 规则：目录在前，文件在后；同类型按名称字母序排序
   */
  function sortNodes(nodeList: VfsNode[]): VfsNode[] {
    return [...nodeList].sort((a, b) => {
      // 首先按父节点路径排序，确保父节点在子节点之前
      const aPath = a.path.split('/').slice(0, -1).join('/')
      const bPath = b.path.split('/').slice(0, -1).join('/')
      if (aPath !== bPath) {
        return aPath.localeCompare(bPath)
      }

      // 同层级：目录在前
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }

      // 同类型按名称字母序排序（不区分大小写）
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }

  /**
   * 查找节点的所有子节点
   */
  function findChildren(nodeId: string): VfsNode[] {
    return nodes.value.filter(n => n.parentId === nodeId)
  }

  /**
   * 查找节点的所有后代节点（递归）
   */
  function findDescendants(nodeId: string): VfsNode[] {
    const descendants: VfsNode[] = []
    const children = findChildren(nodeId)

    for (const child of children) {
      descendants.push(child)
      descendants.push(...findDescendants(child.id))
    }

    return descendants
  }

  /**
   * 查找节点的父节点
   */
  function findParent(node: VfsNode): VfsNode | null {
    if (!node.parentId) return null
    return nodes.value.find(n => n.id === node.parentId) || null
  }

  /**
   * 查找节点的所有祖先节点（从直接父节点到根节点）
   */
  function findAncestors(node: VfsNode): VfsNode[] {
    const ancestors: VfsNode[] = []
    let current = findParent(node)

    while (current) {
      ancestors.push(current)
      current = findParent(current)
    }

    return ancestors
  }

  /**
   * 计算新节点的路径
   * @param name 节点名称
   * @param parentId 父节点 ID
   */
  function calculatePath(name: string, parentId: string | null): string {
    if (!parentId) {
      return `/${name}`
    }

    const parent = nodes.value.find(n => n.id === parentId)
    if (!parent) {
      return `/${name}`
    }

    return `${parent.path}/${name}`
  }

  /**
   * 检查名称在同级目录下是否唯一
   */
  function isNameUnique(name: string, parentId: string | null, excludeId?: string): boolean {
    const siblings = nodes.value.filter(n => n.parentId === parentId)
    return !siblings.some(n => n.name === name && n.id !== excludeId)
  }

  /**
   * 获取同级节点的下一个 sortOrder 值
   */
  function getNextSortOrder(parentId: string | null): number {
    const siblings = nodes.value.filter(n => n.parentId === parentId)
    if (siblings.length === 0) return 0
    return Math.max(...siblings.map(n => n.sortOrder)) + 1
  }

  /**
   * 获取根节点列表
   */
  const rootNodes = computed(() => {
    return sortNodes(nodes.value.filter(n => n.parentId === null))
  })

  /**
   * 按 ID 获取节点
   */
  function getNodeById(nodeId: string): VfsNode | undefined {
    return nodes.value.find(n => n.id === nodeId)
  }

  /**
   * 按路径获取节点
   */
  function getNodeByPath(path: string): VfsNode | undefined {
    return nodes.value.find(n => n.path === path)
  }

  return {
    // 转换后的树形数据
    treeData,
    rootNodes,

    // 路径处理函数
    pathToHierarchy,
    hierarchyToPath,

    // 节点查询函数
    findChildren,
    findDescendants,
    findParent,
    findAncestors,
    getNodeById,
    getNodeByPath,

    // 辅助函数
    calculatePath,
    isNameUnique,
    getNextSortOrder,
    sortNodes
  }
}
