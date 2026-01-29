declare interface ObjectConstructor {
  entries<K, V>(o: Partial<Record<K, V>>): [`${K}`, V][];
  keys<K, V>(o: Partial<Record<K, V>>): `${K}`[];
}
