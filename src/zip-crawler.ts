import archiver from 'archiver';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { URL } from 'node:url';

export interface CrawlPageItem {
  markdown?: string;
  url?: string;
  metadata?: {
    title?: string;
    sourceURL?: string;
    description?: string;
    [key: string]: unknown;
  };
}

export interface HierarchicalPageNode {
  url: string;
  relativePath: string;
  title: string;
  markdown: string;
  pathSegments: string[];
}

export function sanitizePathSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
}

export function urlToRelativePath(
  pageUrlStr: string,
  rootUrlStr: string
): { relativePath: string; pathSegments: string[] } {
  try {
    const pageUrl = new URL(pageUrlStr);
    let pathname = pageUrl.pathname;
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const rawSegments = pathname.split('/').filter((s) => s.length > 0);
    const sanitizedSegments = rawSegments.map(sanitizePathSegment);

    if (sanitizedSegments.length === 0) {
      return {
        relativePath: 'index.md',
        pathSegments: ['index.md'],
      };
    }

    const lastSegment = sanitizedSegments[sanitizedSegments.length - 1];
    if (!lastSegment.endsWith('.md')) {
      sanitizedSegments[sanitizedSegments.length - 1] = `${lastSegment}.md`;
    }

    const relativePath = sanitizedSegments.join('/');
    return {
      relativePath,
      pathSegments: sanitizedSegments,
    };
  } catch {
    const fallbackName = sanitizePathSegment(pageUrlStr) + '.md';
    return {
      relativePath: fallbackName,
      pathSegments: [fallbackName],
    };
  }
}

export function writeHierarchicalFolder(
  outputDir: string,
  pages: CrawlPageItem[],
  rootUrlStr: string
): { totalPages: number; nodes: HierarchicalPageNode[] } {
  const nodes: HierarchicalPageNode[] = [];
  const processedPaths = new Set<string>();

  for (const page of pages) {
    const pageUrlStr =
      page.url || page.metadata?.sourceURL || (page.metadata?.url as string | undefined);
    if (!pageUrlStr) continue;

    const { relativePath, pathSegments } = urlToRelativePath(
      pageUrlStr,
      rootUrlStr
    );

    let finalRelativePath = relativePath;
    let counter = 1;
    while (processedPaths.has(finalRelativePath)) {
      const ext = path.extname(relativePath);
      const base = relativePath.slice(0, -ext.length);
      finalRelativePath = `${base}_${counter}${ext}`;
      counter++;
    }
    processedPaths.add(finalRelativePath);

    const fullFilePath = path.join(outputDir, finalRelativePath);
    const parentDir = path.dirname(fullFilePath);

    fs.mkdirSync(parentDir, { recursive: true });

    const title =
      page.metadata?.title || path.basename(finalRelativePath, '.md');
    const markdownContent =
      page.markdown || `# ${title}\n\n*No content extracted.*`;

    fs.writeFileSync(fullFilePath, markdownContent, 'utf-8');

    nodes.push({
      url: pageUrlStr,
      relativePath: finalRelativePath,
      title,
      markdown: markdownContent,
      pathSegments,
    });
  }

  // Generate root README.md index
  nodes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const readmeLines = [
    `# Crawled Documentation Hierarchy Index`,
    ``,
    `- **Target Start URL**: \`${rootUrlStr}\``,
    `- **Total Pages Crawled**: ${nodes.length}`,
    `- **Generated At**: ${new Date().toISOString()}`,
    ``,
    `## 📁 Directory & File Index`,
    ``,
  ];

  for (const node of nodes) {
    const indent = '  '.repeat(Math.max(0, node.pathSegments.length - 1));
    const fileName = path.basename(node.relativePath);
    readmeLines.push(
      `${indent}- [${node.title}](./${node.relativePath}) (\`${fileName}\`)`
    );
  }

  readmeLines.push(``);
  readmeLines.push(`---`);
  readmeLines.push(`*Generated automatically by Firecrawl MCP Server.*`);

  const readmePath = path.join(outputDir, 'README.md');
  fs.writeFileSync(readmePath, readmeLines.join('\n'), 'utf-8');

  return {
    totalPages: nodes.length,
    nodes,
  };
}

export function zipDirectoryToBuffer(sourceDir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    const buffers: Buffer[] = [];

    archive.on('data', (data: Buffer) => {
      buffers.push(data);
    });

    archive.on('end', () => {
      resolve(Buffer.concat(buffers));
    });

    archive.on('error', (err: Error) => {
      reject(err);
    });

    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

export async function packageCrawlResultsToZip(
  pages: CrawlPageItem[],
  rootUrl: string,
  outputPath?: string
): Promise<{
  totalPages: number;
  zipBuffer: Buffer;
  zipSizeBytes: number;
  outputPath?: string;
  files: string[];
}> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-crawl-zip-'));
  try {
    const { totalPages, nodes } = writeHierarchicalFolder(
      tempDir,
      pages,
      rootUrl
    );
    const zipBuffer = await zipDirectoryToBuffer(tempDir);

    let savedPath: string | undefined = undefined;
    if (outputPath) {
      const resolvedPath = path.resolve(outputPath);
      const parentDir = path.dirname(resolvedPath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(resolvedPath, zipBuffer);
      savedPath = resolvedPath;
    }

    return {
      totalPages,
      zipBuffer,
      zipSizeBytes: zipBuffer.length,
      outputPath: savedPath,
      files: nodes.map((n) => n.relativePath),
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
