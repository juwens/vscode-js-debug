/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import ts from 'typescript';
import { invalidLogPointSyntax } from '../dap/errors';
import { ProtocolError } from '../dap/protocolError';
import { getSyntaxErrorIn } from './sourceUtils';

/**
 * function (params) { code } => function (params) { catchAndReturnErrors?(code) }
 * statement => function () { return catchAndReturnErrors?(return statement) }
 * statement; statement => function () { catchAndReturnErrors?(statement; return statement;) }
 * */
export function statementsToFunction(
  parameterNames: string,
  statements: ReadonlyArray<ts.Statement>,
  catchAndReturnErrors: boolean,
) {
  if (statements.length === 1 && statements[0].kind === ts.SyntaxKind.FunctionDeclaration) {
    const functionDeclarationCode = statements[0].getText();
    const callFunctionCode = `return (${functionDeclarationCode}).call(this, ${parameterNames});`;
    return codeToFunctionExecutingCode(
      parameterNames,
      callFunctionCode,
      true,
      catchAndReturnErrors,
    );
  } else {
    return statementToFunction(parameterNames, statements, true, catchAndReturnErrors);
  }
}

/**
 * code => (parameterNames) => return catchAndReturnErrors?(code)
 * */
function codeToFunctionExecutingCode(
  parameterNames: string,
  code: string,
  preserveThis: boolean,
  catchAndReturnErrors: boolean,
): string {
  return (
    (preserveThis ? `function _generatedCode(${parameterNames}) ` : `(${parameterNames}) => `) +
    (catchAndReturnErrors
      ? `{
  try {
${code}
  } catch (e) {
    return e.stack || e.message || String(e);
  }
}`
      : `{${code}}`)
  );
}

/**
 * function (params) { code } => (function (params) { code })(argumentsText)
 * */
export function functionToFunctionCall(argumentsText: string, functionCode: string): string {
  return `(${functionCode})(${argumentsText})`;
}

/**
 * statement => catchAndReturnErrors(return statement);
 * statement; statement => catchAndReturnErrors(statement; return statement);
 * */
export function returnErrorsFromStatements(
  parameterNames: string,
  statements: ReadonlyArray<ts.Statement>,
  preserveThis: boolean,
) {
  return functionToFunctionCall(
    parameterNames,
    statementToFunction(parameterNames, statements, preserveThis, /*catchAndReturnErrors*/ true),
  );
}

/**
 * statement => function () { catchAndReturnErrors(return statement); }
 * statement; statement => function () { catchAndReturnErrors(statement; return statement); }
 * */
export function statementToFunction(
  parameterNames: string,
  statements: ReadonlyArray<ts.Statement>,
  preserveThis: boolean,
  catchAndReturnErrors: boolean,
) {
  const output = [];

  for (let i = 0; i < statements.length; i++) {
    let stmt = statements[i].getText().trim();
    if (!stmt.endsWith(';')) {
      stmt += ';';
    }

    if (i === statements.length - 1) {
      const returned = `return ${stmt}`;
      if (!getSyntaxErrorIn(returned)) {
        output.push(`    ${returned}`);
        break;
      }
    }

    output.push(`    ${stmt}`);
  }

  const result = codeToFunctionExecutingCode(
    parameterNames,
    output.join('\n'),
    preserveThis,
    catchAndReturnErrors,
  );
  const error = getSyntaxErrorIn(result);
  if (error) {
    throw new ProtocolError(invalidLogPointSyntax(error.message));
  }

  return result;
}
