import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useZipExport } from "../useZipExport";
import type { VfsNode } from "../../types";

// Mock JSZip
const mockFile = vi.fn();
const mockFolder = vi.fn();
const mockGenerateAsync = vi.fn().mockResolvedValue(new Blob(["zip content"]));

vi.mock("jszip", () => {
  return {
    default: class MockJSZip {
      file = mockFile;
      folder = mockFolder;
      generateAsync = mockGenerateAsync;
    },
  };
});

globalThis.URL.createObjectURL = vi.fn(() => "mock-url");
globalThis.URL.revokeObjectURL = vi.fn();

const mockLink = { href: "", download: "", click: vi.fn(), style: {} };
vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);
vi.spyOn(document.body, "appendChild").mockImplementation(() => mockLink as unknown as HTMLElement);
vi.spyOn(document.body, "removeChild").mockImplementation(() => mockLink as unknown as HTMLElement);

describe("useZipExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFile.mockReturnThis();
    mockFolder.mockReturnValue({ file: mockFile, folder: mockFolder });
  });

  const createNode = (
    id: string,
    name: string,
    type: "file" | "directory",
    parentId: string | null,
    content?: string,
    path?: string,
  ): VfsNode => ({
    id,
    treeId: "tree1",
    name,
    path: path || `/${name}`,
    parentId,
    type,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    sourceType: type === "file" ? "static" : undefined,
    sourceConfig: content ? { content } : undefined,
  });

  it("exports all files when no root node is provided", async () => {
    const nodes = ref<VfsNode[]>([
      createNode("1", "rootfile.txt", "file", null, "root content", "/rootfile.txt"),
      createNode("2", "folder1", "directory", null, undefined, "/folder1"),
      createNode("3", "subfile.txt", "file", "2", "sub content", "/folder1/subfile.txt"),
    ]);

    const { exportToZip } = useZipExport(nodes);
    await exportToZip();

    expect(mockFile).toHaveBeenCalledWith("rootfile.txt", "root content");
    expect(mockFolder).toHaveBeenCalledWith("folder1");
    expect(mockFile).toHaveBeenCalledWith("folder1/subfile.txt", "sub content");
  });

  it("exports specific folder and preserves relative structure", async () => {
    const nodes = ref<VfsNode[]>([
      createNode("1", "src", "directory", null, undefined, "/src"),
      createNode("2", "components", "directory", "1", undefined, "/src/components"),
      createNode("3", "App.vue", "file", "1", "vue code", "/src/App.vue"),
      createNode("4", "Button.vue", "file", "2", "button code", "/src/components/Button.vue"),
    ]);

    const { exportToZip } = useZipExport(nodes);
    await exportToZip(nodes.value[0]);

    expect(mockFolder).toHaveBeenCalledWith("src");
    expect(mockFolder).toHaveBeenCalledWith("src/components");
    expect(mockFile).toHaveBeenCalledWith("src/App.vue", "vue code");
    expect(mockFile).toHaveBeenCalledWith("src/components/Button.vue", "button code");
  });
});
