/** The online help: one markdown file per topic and language, in `help/<language>/NN-topic.md`. */

const files = import.meta.glob<string>("./help/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface HelpTopic {
  slug: string;
  title: string;
  body: string;
}

const byLanguage = new Map<string, HelpTopic[]>();
for (const path of Object.keys(files).sort()) {
  const [, language, file] = /\.\/help\/([^/]+)\/(.+)\.md$/.exec(path) ?? [];
  if (!language || !file) continue;
  const body = files[path]!;
  const topic: HelpTopic = {
    slug: file.replace(/^\d+-/, ""),
    title: /^#\s+(.+)$/m.exec(body)?.[1] ?? file,
    body,
  };
  byLanguage.set(language, [...(byLanguage.get(language) ?? []), topic]);
}

/** The topics in a language, in order; English when the language has none. */
export function helpTopics(language: string): HelpTopic[] {
  return byLanguage.get(language) ?? byLanguage.get("en") ?? [];
}
