import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';

/**
 * AccuracyGraph — 7-day area chart showing predicted vs actual wait times.
 * Dark mode support.
 */
export default function AccuracyGraph({ data, dark }) {
  // Fallback mock data for demo
  const chartData = data && data.length > 0 ? data : [
    { day: 'Mon', predicted: 12, actual: 11 },
    { day: 'Tue', predicted: 14, actual: 13 },
    { day: 'Wed', predicted: 11, actual: 12 },
    { day: 'Thu', predicted: 15, actual: 14 },
    { day: 'Fri', predicted: 13, actual: 11 },
    { day: 'Sat', predicted: 10, actual: 9 },
    { day: 'Sun', predicted: 8, actual: 8 },
  ];

  const cardClass = dark ? 'card-dark' : 'card';
  const headingClass = dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant';
  const tickColor = dark ? 'rgba(255,255,255,0.4)' : '#454652';
  const axisColor = dark ? 'rgba(255,255,255,0.06)' : '#e8eaed';

  return (
    <div className={cardClass} id="accuracy-graph">
      <h3 className={`font-display text-sm font-bold uppercase tracking-wider mb-5 flex items-center gap-2 ${headingClass}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        Prediction Accuracy
      </h3>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="gradPredicted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a7db9" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#1a7db9" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: tickColor }}
            axisLine={{ stroke: axisColor }}
            tickLine={false}
          />
          <YAxis
            unit="m"
            tick={{ fontSize: 10, fill: tickColor }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              background: dark ? 'rgba(28, 30, 42, 0.95)' : 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(12px)',
              border: dark ? '1px solid rgba(255,255,255,0.08)' : 'none',
              borderRadius: '12px',
              boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.4)' : '0 8px 24px rgba(0,0,0,0.1)',
              fontSize: '11px',
              color: dark ? '#e2e8f0' : '#191c1e',
            }}
          />
          <Legend
            iconType="circle"
            iconSize={6}
            wrapperStyle={{ fontSize: '10px', paddingTop: '8px', color: tickColor }}
          />
          <Area
            type="monotone"
            dataKey="predicted"
            stroke="#1a7db9"
            strokeWidth={2}
            strokeDasharray="5 5"
            fill="url(#gradPredicted)"
            dot={{ fill: '#1a7db9', r: 3, strokeWidth: 0 }}
            name="Predicted"
          />
          <Area
            type="monotone"
            dataKey="actual"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#gradActual)"
            dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }}
            name="Actual"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
