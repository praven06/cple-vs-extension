const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

let outputChannel;
let diagnosticCollection;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  

  
  outputChannel = vscode.window.createOutputChannel("CPLE");
  diagnosticCollection = vscode.languages.createDiagnosticCollection("cple");

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("cple.compile", () => compileFile(context)),
    vscode.commands.registerCommand("cple.run", () => runFile(context)),
    vscode.commands.registerCommand("cple.checkSyntax", () =>
      checkSyntax(context)
    ),
    vscode.commands.registerCommand("cple.debug", () => debugCompiler(context)),
    outputChannel,
    diagnosticCollection
  );

  // Auto-compile on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId === "cple") {
        const config = vscode.workspace.getConfiguration("cple");
        if (config.get("compileOnSave")) {
          await compileFile(context, document);
        }
      }
    })
  );

  // Clear diagnostics when file is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId === "cple") {
        diagnosticCollection.delete(document.uri);
      }
    })
  );
}

async function compileFile(context, document = null) {
  const editor = vscode.window.activeTextEditor;

  if (!document) {
    if (!editor) {
      vscode.window.showErrorMessage("No active CPLE file");
      return false;
    }
    document = editor.document;
  }

  if (document.languageId !== "cple") {
    vscode.window.showErrorMessage("Not a CPLE file");
    return false;
  }

  // Save the file first
  if (document.isDirty) {
    await document.save();
  }

  const filePath = document.uri.fsPath;
  const config = vscode.workspace.getConfiguration("cple");

  if (config.get("showOutputOnCompile")) {
    outputChannel.show(true);
  }


  const compilerPath = getCompilerPath(context);

  if (!fs.existsSync(compilerPath)) {
    const errorMsg = `CPLE compiler not found at: ${compilerPath}`;
    outputChannel.appendLine(`❌ Error: ${errorMsg}`);
    vscode.window.showErrorMessage(errorMsg);
    return false;
  }

  // Clear previous diagnostics
  diagnosticCollection.delete(document.uri);

  // Build command
  const additionalArgs = config.get("compilerArgs") || "";
  const command = `"${compilerPath}" "${filePath}" ${additionalArgs}`.trim();

  outputChannel.appendLine(`$ ${command}\n`);

  return new Promise((resolve) => {
    const startTime = Date.now();

    cp.exec(
      command,
      {
        cwd: path.dirname(filePath),
        timeout: 30000, // 30 second timeout
      },
      (error, stdout, stderr) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (error) {
          outputChannel.appendLine("❌ Compilation Failed!\n");
          outputChannel.appendLine("Error Output:");
          outputChannel.appendLine(stderr || error.message);

          vscode.window.showErrorMessage(
            `CPLE compilation failed (${duration}s)`
          );

          // Parse and show errors
          parseCompilerErrors(document, stderr || error.message);
          resolve(false);
        } else {
          outputChannel.appendLine("✅ Compilation Successful!\n");

          if (stdout.trim()) {
            outputChannel.appendLine("Compiler Output:");
            outputChannel.appendLine(stdout);
          }

          outputChannel.appendLine(`\n⏱️  Completed in ${duration}s`);
          vscode.window.showInformationMessage(
            `CPLE compiled successfully (${duration}s)`
          );
          resolve(true);
        }
      }
    );
  });
}

async function runFile(context) {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.languageId !== "cple") {
    vscode.window.showErrorMessage("No active CPLE file");
    return;
  }

  // First compile
  const compiled = await compileFile(context);

  if (!compiled) {
    return;
  }


  const filePath = editor.document.uri.fsPath;
  const fileDir = path.dirname(filePath);
  const fileBase = path.basename(filePath, ".cple");

  // Try common output file patterns
  const possibleOutputs = [
    path.join(fileDir, fileBase + ".exe"), // hello.exe
    path.join(fileDir, fileBase), // hello (no extension)
    path.join(fileDir, fileBase + ".out"), // hello.out
    path.join(fileDir, "a.out"), // a.out
    path.join(fileDir, "a.exe"), // a.exe
    path.join(fileDir, "output.exe"), // output.exe
    path.join(fileDir, "out.exe"), // out.exe
    path.join(fileDir, "..", fileBase + ".exe"), // Parent directory
    path.join(fileDir, "..", "output", fileBase + ".exe"), // output subfolder
    path.join(fileDir, "..", fileBase), // Parent, no extension
    path.join(path.dirname(fileDir), fileBase + ".exe"), // Up one level
  ];

  let outputFile = null;

 
  for (const file of possibleOutputs) {
    if (fs.existsSync(file)) {
      outputFile = file;
      outputChannel.appendLine(`   ✅ Found: ${file}\n`);
      break;
    }
  }

 
    


  outputChannel.appendLine(`Executing: ${path.basename(outputFile)}\n`);
  outputChannel.appendLine("─".repeat(60));
  outputChannel.appendLine("Program Output:");
  outputChannel.appendLine("─".repeat(60) + "\n");

  const startTime = Date.now();

  cp.exec(
    `"${outputFile}"`,
    {
      cwd: fileDir,
      timeout: 30000,
    },
    (error, stdout, stderr) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (error && error.code !== 0) {
        outputChannel.appendLine("\n❌ Runtime Error!\n");
        if (stderr) outputChannel.appendLine(stderr);
        outputChannel.appendLine(error.message);
        vscode.window.showErrorMessage("Program execution failed");
      } else {
        if (stdout) {
          outputChannel.appendLine(stdout);
        }
        if (stderr) {
          outputChannel.appendLine("\nStderr:");
          outputChannel.appendLine(stderr);
        }
        if (!stdout && !stderr) {
          outputChannel.appendLine("(No output)");
        }
      }

      outputChannel.appendLine("\n" + "─".repeat(60));
      outputChannel.appendLine(`⏱️  Execution time: ${duration}s`);
    }
  );
}

async function checkSyntax(context) {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.languageId !== "cple") {
    vscode.window.showErrorMessage("No active CPLE file");
    return;
  }

  vscode.window.showInformationMessage("Checking CPLE syntax...");
  await compileFile(context);
}

async function debugCompiler(context) {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.languageId !== "cple") {
    vscode.window.showErrorMessage("No active CPLE file");
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const fileDir = path.dirname(filePath);
  const compilerPath = getCompilerPath(context);

  outputChannel.show(true);
  outputChannel.clear();
  outputChannel.appendLine("🔧 CPLE COMPILER DEBUG INFORMATION");
  outputChannel.appendLine("═".repeat(60) + "\n");

  outputChannel.appendLine("📍 Paths:");
  outputChannel.appendLine(`   Compiler: ${compilerPath}`);
  outputChannel.appendLine(`   File: ${filePath}`);
  outputChannel.appendLine(`   Directory: ${fileDir}`);
  outputChannel.appendLine(`   Platform: ${process.platform}\n`);

  // Check if compiler exists
  if (!fs.existsSync(compilerPath)) {
    outputChannel.appendLine("❌ Compiler not found!\n");
    return;
  }

  outputChannel.appendLine("✅ Compiler found\n");
  outputChannel.appendLine("─".repeat(60));

  // List files BEFORE compilation
  outputChannel.appendLine("\n📁 Files in directory BEFORE compilation:");
  const filesBefore = fs.readdirSync(fileDir);
  filesBefore.forEach((f) => {
    const stats = fs.statSync(path.join(fileDir, f));
    const type = stats.isDirectory() ? "[DIR]" : "[FILE]";
    outputChannel.appendLine(`   ${type} ${f}`);
  });

  outputChannel.appendLine("\n─".repeat(60));
  outputChannel.appendLine("\n▶️  Compiling to detect output...\n");

  // Compile
  const config = vscode.workspace.getConfiguration("cple");
  const additionalArgs = config.get("compilerArgs") || "";
  const command = `"${compilerPath}" "${filePath}" ${additionalArgs}`.trim();

  outputChannel.appendLine(`Command: ${command}\n`);

  cp.exec(command, { cwd: fileDir }, (error, stdout, stderr) => {
    if (error) {
      outputChannel.appendLine("❌ Compilation failed:");
      outputChannel.appendLine(stderr || error.message);
    } else {
      outputChannel.appendLine("✅ Compilation output:");
      outputChannel.appendLine(stdout || "(no output)");
    }

    outputChannel.appendLine("\n─".repeat(60));
    outputChannel.appendLine("\n📁 Files in directory AFTER compilation:");

    const filesAfter = fs.readdirSync(fileDir);
    filesAfter.forEach((f) => {
      const stats = fs.statSync(path.join(fileDir, f));
      const type = stats.isDirectory() ? "[DIR]" : "[FILE]";
      const isNew = !filesBefore.includes(f) ? " ⭐ NEW" : "";
      outputChannel.appendLine(`   ${type} ${f}${isNew}`);
    });

    // Find new files
    const newFiles = filesAfter.filter((f) => !filesBefore.includes(f));

    outputChannel.appendLine("\n─".repeat(60));

    if (newFiles.length > 0) {
      outputChannel.appendLine("\n✨ NEW FILES CREATED:");
      newFiles.forEach((f) => {
        const fullPath = path.join(fileDir, f);
        const stats = fs.statSync(fullPath);
        const size = (stats.size / 1024).toFixed(2);
        outputChannel.appendLine(`   ✅ ${f} (${size} KB)`);
        outputChannel.appendLine(`      Full path: ${fullPath}`);
      });

      outputChannel.appendLine("\n💡 SOLUTION:");
      outputChannel.appendLine(`   Your compiler creates: ${newFiles[0]}`);
      outputChannel.appendLine(
        "   Update the possibleOutputs array in extension.js to include this pattern."
      );
    } else {
      outputChannel.appendLine("\n⚠️  NO NEW FILES CREATED!");
      outputChannel.appendLine("\n💡 Possible reasons:");
      outputChannel.appendLine(
        "   1. Compiler outputs to a different directory"
      );
      outputChannel.appendLine(
        "   2. Compiler needs additional flags (like -o output.exe)"
      );
      outputChannel.appendLine(
        "   3. Compilation failed but didn't report error"
      );
      outputChannel.appendLine(
        "   4. Output file has same name as an existing file"
      );

      outputChannel.appendLine(
        "\n💡 Try adding to Settings → CPLE → Compiler Args:"
      );
      outputChannel.appendLine("   -o output.exe");
    }

    outputChannel.appendLine("\n" + "═".repeat(60));
    outputChannel.appendLine(
      "Debug complete! Check the output above for details."
    );
  });
}

function getCompilerPath(context) {
  const config = vscode.workspace.getConfiguration("cple");
  const customPath = config.get("compilerPath");

  // Use custom path if provided and exists
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  // Platform-specific compiler name
  let compilerName = "cple.out";
  if (process.platform === "win32") {
    compilerName = "cple.exe";
  } else if (process.platform === "darwin") {
    compilerName = "cple.out"; // macOS
  }

  // Return bundled compiler path
  return path.join(context.extensionPath, "compiler", compilerName);
}

function parseCompilerErrors(document, errorOutput) {
  if (!errorOutput) return;

  const diagnostics = [];
  const lines = errorOutput.split("\n");

  // Common error patterns for C-like compilers
  // Adjust these regex patterns based on your compiler's error format
  const patterns = [
    // "file.cple:5:10: error: message"
    /([^:]+):(\d+):(\d+):\s*(error|warning):\s*(.+)/i,
    // "line 5: error message"
    /line\s+(\d+):\s*(.+)/i,
    // "Error at line 5, column 10: message"
    /error\s+at\s+line\s+(\d+)(?:,\s*column\s+(\d+))?:\s*(.+)/i,
    // "file.cple(5): error: message"
    /[^(]+\((\d+)\):\s*(error|warning):\s*(.+)/i,
    // "Error: line 5: message"
    /error:\s*line\s+(\d+):\s*(.+)/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);

      if (match) {
        let lineNum, colNum, message, severity;

        if (match.length === 6) {
          // Format: file:line:col:type:message
          lineNum = parseInt(match[2]) - 1;
          colNum = parseInt(match[3]);
          severity =
            match[4].toLowerCase() === "error"
              ? vscode.DiagnosticSeverity.Error
              : vscode.DiagnosticSeverity.Warning;
          message = match[5];
        } else if (match.length === 3) {
          // Format: line X: message
          lineNum = parseInt(match[1]) - 1;
          colNum = 0;
          severity = vscode.DiagnosticSeverity.Error;
          message = match[2];
        } else if (match.length === 4) {
          // Format: error at line X, column Y: message or file(line): type: message
          lineNum = parseInt(match[1]) - 1;
          if (match[2] && !isNaN(parseInt(match[2]))) {
            colNum = parseInt(match[2]);
            message = match[3];
          } else {
            colNum = 0;
            severity =
              match[2] && match[2].toLowerCase() === "warning"
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Error;
            message = match[3];
          }
          if (typeof severity === "undefined") {
            severity = vscode.DiagnosticSeverity.Error;
          }
        }

        if (typeof lineNum !== "undefined") {
          const range = new vscode.Range(lineNum, colNum, lineNum, colNum + 20);

          const diagnostic = new vscode.Diagnostic(
            range,
            message.trim(),
            severity
          );

          diagnostic.source = "cple";
          diagnostics.push(diagnostic);
          break; // Found a match, move to next line
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    diagnosticCollection.set(document.uri, diagnostics);
  }
}

function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}

module.exports = {
  activate,
  deactivate,
};
