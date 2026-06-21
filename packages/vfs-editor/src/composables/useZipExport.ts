import { type Ref } from 'vue'
import JSZip from 'jszip'
import type { VfsNode } from '../types'
import { useVfsTree } from './useVfsTree'

export function useZipExport(nodes: Ref<VfsNode[]>) {
  const { findDescendants } = useVfsTree({ nodes })

  const exportToZip = async (rootNode?: VfsNode) => {
    const zip = new JSZip()
    let nodesToExport: VfsNode[] = []
    let basePath = ''

    if (rootNode) {
      nodesToExport = [rootNode, ...findDescendants(rootNode.id)]
      // Calculate base path to preserve the root node's name in the archive
      // e.g. /src/components -> base /src -> relative components/...
      const lastSlashIndex = rootNode.path.lastIndexOf('/')
      basePath = rootNode.path.substring(0, lastSlashIndex)
    } else {
      nodesToExport = nodes.value
      basePath = ''
    }

    for (const node of nodesToExport) {
      let relativePath = node.path
      
      // Remove base path
      if (basePath && relativePath.startsWith(basePath)) {
        relativePath = relativePath.substring(basePath.length)
      }
      
      // Remove leading slash if present
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1)
      }

      if (node.type === 'directory') {
        zip.folder(relativePath)
      } else {
        // Handle file content
        let content = ''
        if (node.sourceConfig && 'content' in node.sourceConfig) {
          content = node.sourceConfig.content
        }
        // TODO: Handle other source types if needed (e.g. online-docs)
        // For now, assuming static content is primary for export
        
        zip.file(relativePath, content)
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    
    // Format timestamp: YYYY-MM-DD-HH-mm-ss
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-').split('T').join('-').split('Z')[0]
    link.download = `vfs-export-${timestamp}.zip`
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  }

  return {
    exportToZip
  }
}
