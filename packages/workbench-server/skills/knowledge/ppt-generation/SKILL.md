## Analysis Report PPT Generation Skill

Organize an analysis report into a slide structure suitable for presentation, and output it as a single HTML presentation that can be opened offline.

## Design Principles

- Present conclusions first, then evidence, and finally action recommendations.
- Each page expresses only one clear viewpoint; titles use conclusion sentences rather than generic section names.
- Prioritize preserving the report's key numbers, comparison relationships, trends, and anomalies.
- Place a chart and its explanation on the same page; avoid showing charts without conclusions.
- Keep the output content JSON/Markdown-friendly, easy for AI to read, modify, and regenerate.
- Prefer outputting standard `.pptx`; also generate `.ppt.html` as an offline preview and presentation version.

## Recommended Page Structure

1. Cover: report topic, analysis scope, generation time.
2. Executive summary: no more than three key conclusions.
3. Core metrics: key numbers such as scale, change rate, target completion.
4. Key findings: expand by analysis dimension, one page or a group of pages per dimension.
5. Trends and comparisons: use line, bar, or grouped charts to explain the source of changes.
6. Anomalies and risks: clearly state the anomalous objects, impact, and judgment basis.
7. Action recommendations: recommendation, priority, owner, or next verification method.

## Content Constraints

- Keep the default to 6 to 12 pages; do not force page splits when the report is short.
- A single page's body should not exceed 5 bullet points, each ideally not exceeding two lines.
- Values must preserve the original unit and time range; do not guess when it cannot be confirmed.
- Conclusions should find a basis in the report body or chart data.
- Chart HTML should remain self-contained and runnable safely within an iframe.

## Output Contract

```json
{
  "title": "report title",
  "slides": [
    {
      "title": "conclusion sentence",
      "body": "Markdown body",
      "chart": "optional self-contained HTML chart",
      "source": "the corresponding report section or data source"
    }
  ],
"format": "pptx",
"previewFormat": "single-html",
"offline": true
}
```
