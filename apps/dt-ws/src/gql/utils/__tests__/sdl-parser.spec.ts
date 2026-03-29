import { extractDeclaredFields } from '../sdl-parser';

describe('extractDeclaredFields', () => {
  describe('object type definitions', () => {
    it('should extract fields from a simple object type', () => {
      const sdl = 'type Foo { bar: String, baz: Int }';
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['Foo.bar', 'Foo.baz']));
    });

    it('should extract fields from multiple object types', () => {
      const sdl = `
        type Alpha { x: Int }
        type Beta { y: String }
      `;
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['Alpha.x', 'Beta.y']));
    });

    it('should handle types with complex field types', () => {
      const sdl = `
        type Foo {
          items: [Bar!]!
          nested: Baz
        }
      `;
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['Foo.items', 'Foo.nested']));
    });
  });

  describe('type extensions', () => {
    it('should extract fields from extend type Query', () => {
      const sdl = 'extend type Query { myField: Int }';
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['Query.myField']));
    });

    it('should extract fields from extend type Mutation', () => {
      const sdl = 'extend type Mutation { doThing(input: String!): Boolean }';
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['Mutation.doThing']));
    });

    it('should combine object type and extension fields', () => {
      const sdl = `
        type OpaResult { exposures: [JSON] }
        extend type Query { evaluatePolicy(input: JSON!): OpaResult }
      `;
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['OpaResult.exposures', 'Query.evaluatePolicy']));
    });
  });

  describe('excluded definition kinds', () => {
    it('should ignore input types', () => {
      const sdl = 'input MyInput { field: String }';
      const fields = extractDeclaredFields(sdl);
      expect(fields.size).toBe(0);
    });

    it('should ignore enum types', () => {
      const sdl = 'enum Status { ACTIVE INACTIVE }';
      const fields = extractDeclaredFields(sdl);
      expect(fields.size).toBe(0);
    });

    it('should ignore union types', () => {
      const sdl = `
        type Foo { x: Int }
        type Bar { y: Int }
        union SearchResult = Foo | Bar
      `;
      const fields = extractDeclaredFields(sdl);
      // Only Foo and Bar fields, not the union itself
      expect(fields).toEqual(new Set(['Foo.x', 'Bar.y']));
    });

    it('should ignore interface types', () => {
      const sdl = 'interface Node { id: ID! }';
      const fields = extractDeclaredFields(sdl);
      expect(fields.size).toBe(0);
    });

    it('should ignore scalar types', () => {
      const sdl = 'scalar JSON';
      const fields = extractDeclaredFields(sdl);
      expect(fields.size).toBe(0);
    });
  });

  describe('mixed definitions', () => {
    it('should extract only object type fields from mixed SDL', () => {
      const sdl = `
        type Foo { a: Int }
        input Bar { b: String }
        enum Baz { X Y }
        extend type Query { c: Foo }
      `;
      const fields = extractDeclaredFields(sdl);
      expect(fields).toEqual(new Set(['Foo.a', 'Query.c']));
    });
  });

  describe('error handling', () => {
    it('should return empty set for unparseable SDL', () => {
      const fields = extractDeclaredFields('not valid graphql {{{}}}');
      expect(fields.size).toBe(0);
    });

    it('should return empty set for empty string', () => {
      const fields = extractDeclaredFields('');
      expect(fields.size).toBe(0);
    });

    it('should handle type with no fields', () => {
      // Valid GraphQL: object type with no fields (using extension syntax)
      const sdl = 'type Foo';
      // This may or may not parse depending on GraphQL version; either way should not throw
      const fields = extractDeclaredFields(sdl);
      expect(fields).toBeDefined();
    });
  });
});
