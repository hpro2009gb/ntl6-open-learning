function typeOk(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return true;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateSchemaSubset(schema, value, path = '$') {
  const errors = [];
  if (schema.const !== undefined && !sameValue(value, schema.const)) errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((x) => sameValue(x, value))) errors.push(`${path}: value not in enum`);
  if (schema.type && !typeOk(value, schema.type)) {
    errors.push(`${path}: expected type ${schema.type}`);
    return errors;
  }
  if (schema.type === 'string' && Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${path}: minLength ${schema.minLength}`);
  if ((schema.type === 'integer' || schema.type === 'number') && Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${path}: below minimum`);
  if ((schema.type === 'integer' || schema.type === 'number') && Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${path}: above maximum`);
  if (schema.type === 'array') {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path}: minItems ${schema.minItems}`);
    if (schema.uniqueItems) {
      const seen = new Set(value.map((x) => JSON.stringify(x)));
      if (seen.size !== value.length) errors.push(`${path}: duplicate items`);
    }
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchemaSubset(schema.items, item, `${path}[${i}]`)));
  }
  if (schema.type === 'object') {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in props)) errors.push(`${path}.${key}: additional property`);
    }
    for (const [key, child] of Object.entries(props)) if (key in value) errors.push(...validateSchemaSubset(child, value[key], `${path}.${key}`));
  }
  return errors;
}

export function assertSchemaValid(schema, value) {
  const errors = validateSchemaSubset(schema, value);
  if (errors.length) throw new Error(`SCHEMA_INVALID:\n${errors.join('\n')}`);
  return value;
}
