import { GraphQLError, locatedError } from 'graphql';
import { maskedErrorCode } from '../masked-error-code';

/**
 * The code a masked error keeps is the entire message a production client
 * gets. These pin that a deployment refusing a caller is answered as a
 * refusal and not as a crash — on both transports, since both maskers call
 * this — and that nothing already carrying a code loses it.
 *
 * The library's error classes are not exported, so they are built here the
 * way the library builds them: a GraphQLError whose non-enumerable `name` is
 * the class name. The integration suite pins the real class against the
 * installed version.
 */
function libraryError(name: string, message: string): GraphQLError {
  const e = new GraphQLError(message);
  Object.defineProperty(e, 'name', { value: name });
  return e;
}

describe('maskedErrorCode', () => {
  it('names the library\'s authentication refusal UNAUTHENTICATED, thrown bare or located', () => {
    const bare = libraryError('Neo4jGraphQLAuthenticationError', 'Unauthenticated');
    expect(maskedErrorCode(bare)).toBe('UNAUTHENTICATED');
    // graphql-js wraps what a resolver throws and keeps it as originalError.
    const located = locatedError(bare, undefined, ['secretDocs']);
    expect(maskedErrorCode(located)).toBe('UNAUTHENTICATED');
  });

  // The schema-level check — the one an unlisted caller actually hits — throws the library's base
  // error, whose name is the plain GraphQLError's. The message is the library's exported constant.
  it('names the schema-level refusal by its message, since it carries no class of its own', () => {
    const bare = new GraphQLError('Unauthenticated');
    expect(bare.name).toBe('GraphQLError');
    expect(maskedErrorCode(bare)).toBe('UNAUTHENTICATED');
    expect(maskedErrorCode(locatedError(bare, undefined, ['secretDocs']))).toBe('UNAUTHENTICATED');
  });

  it('names the library\'s forbidden refusal FORBIDDEN, by class or by message', () => {
    expect(maskedErrorCode(libraryError('Neo4jGraphQLForbiddenError', 'Forbidden'))).toBe('FORBIDDEN');
    expect(maskedErrorCode(new GraphQLError('Forbidden'))).toBe('FORBIDDEN');
  });

  it('does not mistake a message that merely mentions the word', () => {
    expect(maskedErrorCode(new GraphQLError('Unauthenticated request to upstream x'))).toBe('INTERNAL_ERROR');
  });

  it('keeps a code the error already carries', () => {
    const own = new GraphQLError('Authentication required', { extensions: { code: 'UNAUTHENTICATED' } });
    expect(maskedErrorCode(own)).toBe('UNAUTHENTICATED');
    const timeout = new GraphQLError('x', { extensions: { code: 'MODULE_RESOLVER_TIMEOUT' } });
    expect(maskedErrorCode(timeout)).toBe('MODULE_RESOLVER_TIMEOUT');
  });

  it('does not let Apollo\'s default label hide a refusal underneath it', () => {
    // Apollo stamps INTERNAL_SERVER_ERROR on anything without a code; the
    // located error underneath is what says what actually happened.
    const located = locatedError(libraryError('Neo4jGraphQLAuthenticationError', 'Unauthenticated'), undefined, ['x']);
    (located.extensions as any).code = 'INTERNAL_SERVER_ERROR';
    expect(maskedErrorCode(located)).toBe('UNAUTHENTICATED');
  });

  it('answers a real crash exactly as before', () => {
    const crash = locatedError(new Error('Neo.ClientError.Schema.ConstraintValidationFailed'), undefined, ['x']);
    expect(maskedErrorCode(crash)).toBe('INTERNAL_ERROR');
    expect(maskedErrorCode(crash, 'INTERNAL_SERVER_ERROR')).toBe('INTERNAL_SERVER_ERROR');
    const labelled = { message: 'x', extensions: { code: 'INTERNAL_SERVER_ERROR' } };
    expect(maskedErrorCode(labelled)).toBe('INTERNAL_SERVER_ERROR');
    expect(maskedErrorCode(undefined)).toBe('INTERNAL_ERROR');
  });
});
