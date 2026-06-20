type ValueLiteral = string | boolean | null | number;
type AttributeMap = Record<string, XnlNode>;
interface ExtendBody {
    order: string[];
    children: Record<string, ElementNode>;
}
type ElementNode = DataElementNode | TextElementNode;
type ElementNodeKind = 'DataElement' | 'TextElement';
interface DataElementNode {
    kind: "DataElement";
    tag: string;
    id?: XnlWord;
    metadata: AttributeMap;
    attributes?: AttributeMap;
    body?: XnlNode[];
    extend?: ExtendBody;
}
interface XnlWord {
    kind: "Word";
    namespace: string[];
    name: string;
}
interface TextElementNode {
    kind: "TextElement";
    tag: string;
    id?: XnlWord;
    metadata: AttributeMap;
    attributes?: AttributeMap;
    text?: string;
    textMarker?: string;
}
interface CommentNode {
    kind: "Comment";
    value: string;
}
type ContainerNode = Array<XnlNode> | Object | ElementNode;
type XnlNode = ValueLiteral | XnlWord | ContainerNode | CommentNode;
declare function isWord(value: any): value is XnlWord;
declare function wordToString(word?: XnlWord | null): string | undefined;
type ParseWarningCode = "DUPLICATE_CHILD";
interface ParseWarning {
    code: ParseWarningCode;
    message: string;
    parentName: string;
    childName: string;
}
interface XnlDocument {
    nodes: XnlNode[];
    warnings?: ParseWarning[];
}
interface SingleNodeResult {
    node: XnlNode;
    warnings: ParseWarning[];
}
interface UniqueChildrenResult {
    node: XnlNode;
    warnings: ParseWarning[];
}

/** Options for parsing. */
interface XnlParseOptions {
    /**
     * Block text style: in addition to the always-on leading-newline strip + dedent,
     * also strip the single structural trailing newline that the block formatter emits
     * before the closing `</?marker>`. Symmetric inverse of the formatter's
     * `textBlockStyle` option, giving stable round-trips for multi-line text blocks.
     */
    textBlockStyle?: boolean;
}
declare function parseXnl(input: string, options?: XnlParseOptions): XnlDocument;
declare function parseXnlSingleNode(input: string, options?: XnlParseOptions): SingleNodeResult;
declare function parseUniqueChildren(name: string, input: string, metadata?: AttributeMap, attributes?: AttributeMap): UniqueChildrenResult;

interface StringifyOptions {
    pretty?: boolean;
    indent?: number | string;
}
declare function stringify$1(value: XnlDocument | XnlNode, options?: StringifyOptions): string;

interface LineBlockStringifyOptions {
    indent?: number | string;
    textMarkerFactory?: () => string;
    /**
     * Block text style: render every (non-inline) TextElement with its content on its
     * own line(s) between the open marker and `</?marker>`, indented to the element's
     * level — even single-line content. Pairs with the parser's `textBlockStyle` option
     * for stable round-trips. Default false keeps the legacy inline-open rendering.
     */
    textBlockStyle?: boolean;
}
declare function stringify(value: XnlDocument | XnlNode, options?: LineBlockStringifyOptions): string;

type PathItemType = "UniqueName" | "MetadataSelector" | "InstanceProperty" | "MapKey" | "ListIndex";
interface PathItem {
    type: PathItemType;
    value: string;
}
type XnlPath = PathItem[];
type MetadataSelectorMode = "identity" | "metadata";
interface ResolveOptions {
    strict?: boolean;
    metadataIdMode?: MetadataSelectorMode;
}
interface SetOptions extends ResolveOptions {
    mode?: "insert" | "replace";
}
declare class XnlPathError extends Error {
}
declare function parsePath(input: string): XnlPath;
declare function resolvePath(target: XnlDocument | XnlNode, path: string | XnlPath, options?: ResolveOptions): any;
declare function setPathValue(target: XnlDocument | XnlNode, path: string | XnlPath, value: any, options?: SetOptions): any;
declare function deleteAtPath(target: XnlDocument | XnlNode, path: string | XnlPath, options?: ResolveOptions): any;

type MutationType = "TREE_ADD" | "TREE_DELETE" | "TREE_MOVE" | "TREE_UPDATE" | "TREE_MOVE_SAME_LEVEL" | "TREE_MOVE_CROSS_LEVEL" | "OBJECT_ADD" | "OBJECT_DELETE" | "OBJECT_UPDATE";
interface XnlMutation {
    type: MutationType;
    path: string | XnlPath;
    pathBefore?: string | XnlPath;
    valueBefore?: XnlNode;
    valueAfter?: XnlNode;
    metadata?: Record<string, unknown>;
    targetUniqueName?: string;
    parentUniqueNameBefore?: string;
    parentUniqueNameAfter?: string;
}
type MetadataIdMode = "identity" | "metadata";
interface XnlMutationOptions {
    metadataIdMode?: MetadataIdMode;
}
declare function applyMutations(root: XnlNode, mutations: XnlMutation[], opts?: XnlMutationOptions): XnlNode;
declare function diffNodes(oldNode: XnlNode, newNode: XnlNode, basePath?: string | XnlPath, opts?: XnlMutationOptions): XnlMutation[];

interface LoaderContext {
    prototypes: Record<string, Record<string, DataElementNode>>;
}
declare function loadFromString(input: string): XnlDocument;
declare function resolveNode(ctx: LoaderContext, node: DataElementNode, scope: Record<string, Record<string, DataElementNode>>[]): DataElementNode;
declare function batchLoad(batches: DataElementNode[][]): {
    resolved: DataElementNode[][];
    exports: Record<string, Record<string, DataElementNode>>;
};

/**
 * vfs-import resolver: resolves document-head `<Imports><Import as="X" src="vfs://...">`
 * directives into per-alias symbol tables, reusing the loader export/batchLoad mechanism.
 *
 * Dependency inversion: this module never touches the filesystem. The caller supplies an
 * `ImportResolver` (xnl-vfs, codument, or a test mock) that reads vfs paths.
 */
type XnlImportErrorCode = "INVALID_IMPORT" | "IMPORT_NOT_FOUND" | "DUPLICATE_IMPORT" | "UNRESOLVED_IMPORT";
declare class XnlImportError extends Error {
    code: XnlImportErrorCode;
    constructor(code: XnlImportErrorCode, message: string);
}
interface ImportResolver {
    /** Return file content for a normalized vfs path, or null if it does not exist. */
    readFile(vfsPath: string): string | null;
    /** Return directory entry names for a vfs dir, or null if not a directory. */
    readDir(vfsPath: string): string[] | null;
    /** Whether the vfs path is a directory. */
    isDir(vfsPath: string): boolean;
}
interface ResolveImportsOptions {
    /** vfs directory of the importing document (for `./` and `../` resolution). */
    baseDir: string;
    /** vfs workspace root (for `@/` resolution). */
    workspaceRoot: string;
}
/** alias -> exported-name -> node */
type ImportSymbols = Record<string, Record<string, XnlNode>>;
interface ResolveImportsResult {
    resolved: XnlDocument;
    symbols: ImportSymbols;
    warnings: string[];
}
/** Resolve a `vfs://...` src against base/workspace per the three addressing forms. */
declare function resolveVfsSrc(src: string, opts: ResolveImportsOptions): string;
/**
 * Resolve a document's `<Imports>` directives into per-alias symbol tables.
 * Documents without an `<Imports>` container are returned unchanged (zero-import fallback).
 */
declare function resolveImports(rootDoc: XnlDocument, resolver: ImportResolver, opts: ResolveImportsOptions): ResolveImportsResult;

type XnlErrorCode = "UNEXPECTED_EOF" | "MISMATCHED_TAG" | "DUPLICATE_CHILD" | "INVALID_CONTENT" | "INVALID_LITERAL" | "UNEXPECTED_TOKEN";
declare class XnlParseError extends Error {
    readonly code: XnlErrorCode;
    readonly position: number;
    readonly line: number;
    readonly column: number;
    constructor(code: XnlErrorCode, message: string, input: string, position: number);
}

declare function GetWordFullName(word: XnlWord): string;
declare function MakeWord(wordStr: string, namespace?: never[]): XnlWord;

declare const XNL: {
    parseMany: typeof parseXnl;
    parseSingle: typeof parseXnlSingleNode;
    parseUnique: typeof parseUniqueChildren;
    stringify: typeof stringify$1;
    stringifyLineBlock: typeof stringify;
    path: {
        parse: typeof parsePath;
        resolve: typeof resolvePath;
        set: typeof setPathValue;
        delete: typeof deleteAtPath;
    };
    mutation: {
        apply: typeof applyMutations;
        diff: typeof diffNodes;
    };
    loader: {
        loadFromString: typeof loadFromString;
        loadNode: typeof resolveNode;
        batchLoad: typeof batchLoad;
    };
    import: {
        resolve: typeof resolveImports;
        resolveVfsSrc: typeof resolveVfsSrc;
    };
};

export { type AttributeMap, type CommentNode, type DataElementNode, type ElementNode, type ElementNodeKind, type ExtendBody, GetWordFullName, type ImportResolver, type ImportSymbols, MakeWord, type MetadataIdMode, type MutationType, type ParseWarning, type PathItem, type PathItemType, type ResolveImportsOptions, type ResolveImportsResult, type SingleNodeResult, type TextElementNode, type UniqueChildrenResult, type ValueLiteral, XNL, type XnlDocument, type XnlErrorCode, XnlImportError, type XnlImportErrorCode, type XnlMutation, type XnlMutationOptions, type XnlNode, XnlParseError, type XnlPath, XnlPathError, type XnlWord, applyMutations, batchLoad, deleteAtPath, diffNodes, isWord, loadFromString, resolveNode as loadNode, parsePath, parseUniqueChildren, parseXnl, parseXnlSingleNode, resolveImports, resolvePath, resolveVfsSrc, setPathValue, stringify as stringifyLineBlock, wordToString };
