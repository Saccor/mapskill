import ts from 'typescript';

/** True when the identifier is a property/member name rather than a reference to a binding. */
export function isPropertyNamePosition(x: ts.Identifier): boolean {
  const p = x.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === x) ||
    (ts.isQualifiedName(p) && p.right === x) ||
    (ts.isPropertyAssignment(p) && p.name === x) ||
    (ts.isJsxAttribute(p) && p.name === x) ||
    ((ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isEnumMember(p)) && p.name === x) ||
    (ts.isBindingElement(p) && p.propertyName === x)
  );
}
