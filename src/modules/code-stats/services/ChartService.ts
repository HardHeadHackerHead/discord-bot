import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { CodeStatsRecord } from './CodeStatsService.js';

const WIDTH = 800;
const HEIGHT = 400;

const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: '#2f3136', // Discord dark theme background
});

export type ChartType = 'lines' | 'files' | 'modules' | 'breakdown';

/**
 * Generate a line chart showing total lines over time
 */
export async function generateLinesChart(history: CodeStatsRecord[]): Promise<Buffer> {
  // Sort by date ascending
  const sorted = [...history].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const labels = sorted.map(r => formatDate(r.recorded_at));
  const totalLines = sorted.map(r => r.totalLines);
  const codeLines = sorted.map(r => r.codeLines);

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Lines',
          data: totalLines,
          borderColor: '#5865f2',
          backgroundColor: 'rgba(88, 101, 242, 0.1)',
          fill: true,
          tension: 0.3,
        },
        {
          label: 'Code Lines',
          data: codeLines,
          borderColor: '#57f287',
          backgroundColor: 'rgba(87, 242, 135, 0.1)',
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'Lines of Code Over Time',
          color: '#ffffff',
          font: { size: 18 },
        },
        legend: {
          labels: { color: '#ffffff' },
        },
      },
      scales: {
        x: {
          ticks: { color: '#b9bbbe' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
        },
        y: {
          ticks: { color: '#b9bbbe' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          beginAtZero: false,
        },
      },
    },
  };

  return chartJSNodeCanvas.renderToBuffer(config);
}

/**
 * Generate a line chart showing file count over time
 */
export async function generateFilesChart(history: CodeStatsRecord[]): Promise<Buffer> {
  const sorted = [...history].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const labels = sorted.map(r => formatDate(r.recorded_at));
  const fileCount = sorted.map(r => r.fileCount);

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Files',
          data: fileCount,
          borderColor: '#fee75c',
          backgroundColor: 'rgba(254, 231, 92, 0.1)',
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'File Count Over Time',
          color: '#ffffff',
          font: { size: 18 },
        },
        legend: {
          labels: { color: '#ffffff' },
        },
      },
      scales: {
        x: {
          ticks: { color: '#b9bbbe' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
        },
        y: {
          ticks: { color: '#b9bbbe' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          beginAtZero: false,
        },
      },
    },
  };

  return chartJSNodeCanvas.renderToBuffer(config);
}

/**
 * Generate a line chart showing module count over time
 */
export async function generateModulesChart(history: CodeStatsRecord[]): Promise<Buffer> {
  const sorted = [...history].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const labels = sorted.map(r => formatDate(r.recorded_at));
  const moduleCount = sorted.map(r => r.moduleCount || 0);

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Modules',
          data: moduleCount,
          borderColor: '#eb459e',
          backgroundColor: 'rgba(235, 69, 158, 0.1)',
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'Module Count Over Time',
          color: '#ffffff',
          font: { size: 18 },
        },
        legend: {
          labels: { color: '#ffffff' },
        },
      },
      scales: {
        x: {
          ticks: { color: '#b9bbbe' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
        },
        y: {
          ticks: {
            color: '#b9bbbe',
            stepSize: 1,
          },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          beginAtZero: true,
        },
      },
    },
  };

  return chartJSNodeCanvas.renderToBuffer(config);
}

/**
 * Generate a pie/doughnut chart showing code breakdown
 */
export async function generateBreakdownChart(stats: CodeStatsRecord): Promise<Buffer> {
  const config: ChartConfiguration = {
    type: 'doughnut',
    data: {
      labels: ['Code Lines', 'Comment Lines', 'Blank Lines'],
      datasets: [
        {
          data: [stats.codeLines, stats.commentLines, stats.blankLines],
          backgroundColor: [
            '#57f287', // Green for code
            '#5865f2', // Blue for comments
            '#b9bbbe', // Gray for blank
          ],
          borderColor: '#2f3136',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: 'Code Breakdown',
          color: '#ffffff',
          font: { size: 18 },
        },
        legend: {
          position: 'bottom',
          labels: {
            color: '#ffffff',
            padding: 20,
          },
        },
      },
    },
  };

  return chartJSNodeCanvas.renderToBuffer(config);
}

/**
 * Generate a chart based on type
 */
export async function generateChart(
  type: ChartType,
  history: CodeStatsRecord[]
): Promise<Buffer> {
  switch (type) {
    case 'lines':
      return generateLinesChart(history);
    case 'files':
      return generateFilesChart(history);
    case 'modules':
      return generateModulesChart(history);
    case 'breakdown': {
      const latest = history[0];
      if (!latest) {
        throw new Error('No stats available for breakdown chart');
      }
      return generateBreakdownChart(latest);
    }
    default:
      throw new Error(`Unknown chart type: ${type}`);
  }
}

/**
 * Format date for chart labels
 */
function formatDate(date: Date): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
