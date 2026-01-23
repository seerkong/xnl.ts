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

declare function parseXnl(input: string): XnlDocument;
declare function parseXnlSingleNode(input: string): SingleNodeResult;
declare function parseUniqueChildren(name: string, input: string, metadata?: AttributeMap, attributes?: AttributeMap): UniqueChildrenResult;

interface StringifyOptions {
    pretty?: boolean;
    indent?: number | string;
}
declare function stringify(value: XnlDocument | XnlNode, options?: StringifyOptions): string;

type PathItemType = "UniqueName" | "MetadataSelector" | "InstanceProperty" | "MapKey" | "ListIndex";
interface PathItem {
    type: PathItemType;
    value: string;
}
type XnlPath = PathItem[];
interface ResolveOptions {
    strict?: boolean;
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
declare function applyMutations(root: XnlNode, mutations: XnlMutation[]): XnlNode;
declare function diffNodes(oldNode: XnlNode, newNode: XnlNode, basePath?: string | XnlPath): XnlMutation[];

interface LoaderContext {
    prototypes: Record<string, Record<string, DataElementNode>>;
}
declare function loadFromString(input: string): XnlDocument;
declare function resolveNode(ctx: LoaderContext, node: DataElementNode, scope: Record<string, Record<string, DataElementNode>>[]): DataElementNode;
declare function batchLoad(batches: DataElementNode[][]): {
    resolved: DataElementNode[][];
    exports: Record<string, Record<string, DataElementNode>>;
};

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
    stringify: typeof stringify;
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
};

export { type AttributeMap, type CommentNode, type DataElementNode, type ElementNode, type ElementNodeKind, type ExtendBody, GetWordFullName, MakeWord, type MutationType, type ParseWarning, type PathItem, type PathItemType, type SingleNodeResult, type TextElementNode, type UniqueChildrenResult, type ValueLiteral, XNL, type XnlDocument, type XnlErrorCode, type XnlMutation, type XnlNode, XnlParseError, type XnlPath, XnlPathError, type XnlWord, applyMutations, batchLoad, deleteAtPath, diffNodes, isWord, loadFromString, resolveNode as loadNode, parsePath, parseUniqueChildren, parseXnl, parseXnlSingleNode, resolvePath, setPathValue, wordToString };
