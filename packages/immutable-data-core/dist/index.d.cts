declare const captureProof: unique symbol;
type CapturedData = object & {
    readonly [captureProof]: true;
};
declare function isCapturedImmutableData(value: unknown): value is CapturedData;
/** Shape only. Elements may still contain undefined, non-finite numbers,
 * ownership fields, aliases or cycles and require their original validators. */
declare function isCapturedDenseArray(value: unknown): boolean;
/** Construct a new captured dense array from an owned dense source, without
 * first creating a mutable array and a second descriptor snapshot. Unknown
 * sources return undefined without invoking the mapper. Results must already
 * be captured values or primitives; this never certifies an external object. */
declare function mapCapturedDataArray<T, U>(source: readonly T[], mapper: (item: T, index: number) => U): U[] | undefined;
declare function captureImmutableData<T>(value: T): T;
/** Replace one existing own data field in a captured container. The caller
 * receives a fresh frozen container, never a proof for an external object. */
declare function replaceCapturedDataProperty<T extends object>(base: T, key: string, value: unknown): T | undefined;

export { captureImmutableData, isCapturedDenseArray, isCapturedImmutableData, mapCapturedDataArray, replaceCapturedDataProperty };
