import {OverlayTrigger, Spinner, Table, Tooltip as OverlayTooltip} from 'react-bootstrap'
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {formatDuration, PROMETHEUS_URL} from '../App'
import {IconExternal} from './Icons'
import {Labels, labelsString, parseLabelValue} from '../labels'
import {
  Alert,
  Alert_State,
  GetAlertsResponse,
  GraphBurnratesResponse,
  Objective,
  Series,
  Timeseries,
} from '../proto/objectives/v1alpha1/objectives_pb'
import {PromiseClient} from '@bufbuild/connect-web'
import {ObjectiveService} from '../proto/objectives/v1alpha1/objectives_connectweb'
import uPlot, {AlignedData} from 'uplot'
import {Duration, Timestamp} from '@bufbuild/protobuf'
import UplotReact from 'uplot-react'
import {burnrate} from './graphs/colors'
import {seriesGaps} from './graphs/gaps'

interface AlertsTableProps {
  client: PromiseClient<typeof ObjectiveService>
  objective: Objective
  grouping: Labels
  from: number
  to: number
  uPlotCursor: uPlot.Cursor
}

const alertStateString = ['inactive', 'pending', 'firing']

const AlertsTable = ({
  client,
  objective,
  grouping,
  from,
  to,
  uPlotCursor,
}: AlertsTableProps): JSX.Element => {
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    client
      .getAlerts({
        expr: labelsString(objective.labels),
        grouping: labelsString(grouping),
        inactive: true,
        current: true,
      })
      .then((resp: GetAlertsResponse) => {
        setAlerts(resp.alerts)
      })
      .catch((err) => console.log(err))
  }, [client, objective, grouping])

  return (
    <div className="table-responsive">
      <Table className="table-alerts">
        <thead>
          <tr>
            <th style={{width: '10%'}}>State</th>
            <th style={{width: '10%'}}>Severity</th>
            <th style={{width: '10%', textAlign: 'right'}}>Exhaustion</th>
            <th style={{width: '12%', textAlign: 'right'}}>Threshold</th>
            <th style={{width: '5%'}} />
            <th style={{width: '10%', textAlign: 'left'}}>Short Burn</th>
            <th style={{width: '5%'}} />
            <th style={{width: '10%', textAlign: 'left'}}>Long Burn</th>
            <th style={{width: '5%', textAlign: 'right'}}>For</th>
            <th style={{width: '10%', textAlign: 'left'}}>Prometheus</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a: Alert, i: number) => {
            let shortCurrent = ''
            if (a.short?.current === -1.0) {
              shortCurrent = 'NaN'
            } else if (a.short?.current === undefined) {
              shortCurrent = (0).toFixed(3).toString()
            } else {
              shortCurrent = a.short.current.toFixed(3)
            }
            let longCurrent = ''
            if (a.long?.current === -1.0) {
              longCurrent = 'NaN'
            } else if (a.long?.current === undefined) {
              longCurrent = (0).toFixed(3).toString()
            } else {
              longCurrent = a.long?.current.toFixed(3)
            }

            return (
              <>
                <tr key={i} className={alertStateString[a.state]}>
                  <td>{alertStateString[a.state]}</td>
                  <td>{a.severity}</td>
                  <td style={{textAlign: 'right'}}>
                    <OverlayTrigger
                      key={i}
                      overlay={
                        <OverlayTooltip id={`tooltip-${i}`}>
                          If this alert is firing, the entire Error Budget can be burnt within that
                          time frame.
                        </OverlayTooltip>
                      }>
                      <span>
                        {formatDuration((Number(objective.window?.seconds) * 1000) / a.factor)}
                      </span>
                    </OverlayTrigger>
                  </td>
                  <td style={{textAlign: 'right'}}>
                    <OverlayTrigger
                      key={i}
                      overlay={
                        <OverlayTooltip id={`tooltip-${i}`}>
                          {a.factor} * (1 - {objective.target})
                        </OverlayTooltip>
                      }>
                      <span>{(a.factor * (1 - objective?.target)).toFixed(3)}</span>
                    </OverlayTrigger>
                  </td>
                  <td style={{textAlign: 'center'}}>
                    <small style={{opacity: 0.5}}>&gt;</small>
                  </td>
                  <td style={{textAlign: 'left'}}>
                    {shortCurrent} ({formatDuration(Number(a.short?.window?.seconds) * 1000)})
                  </td>
                  <td style={{textAlign: 'left'}}>
                    <small style={{opacity: 0.5}}>and</small>
                  </td>
                  <td style={{textAlign: 'left'}}>
                    {longCurrent} ({formatDuration(Number(a.long?.window?.seconds) * 1000)})
                  </td>
                  <td style={{textAlign: 'right'}}>{formatDuration(Number(a.for))}</td>
                  <td>
                    <a
                      className="external-prometheus"
                      target="_blank"
                      rel="noreferrer"
                      href={`${PROMETHEUS_URL}/graph?g0.expr=${encodeURIComponent(
                        a.long?.query ?? '',
                      )}&g0.tab=0&g1.expr=${encodeURIComponent(a.short?.query ?? '')}&g1.tab=0`}>
                      <IconExternal height={20} width={20} />
                    </a>
                  </td>
                </tr>
                <tr
                  style={{
                    display: a.state === Alert_State.firing ? 'table-row' : 'none',
                    backgroundColor: '#f0f0f0',
                  }}>
                  <td colSpan={10}>
                    <BurnrateGraph
                      client={client}
                      labels={objective.labels}
                      grouping={grouping}
                      from={from}
                      to={to}
                      uPlotCursor={uPlotCursor}
                      short={Number(a.short?.window?.seconds)}
                      long={Number(a.long?.window?.seconds)}
                      threshold={a.factor * (1 - objective?.target)}
                    />
                  </td>
                </tr>
              </>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

interface BurnrateGraphProps {
  client: PromiseClient<typeof ObjectiveService>
  labels: Labels
  grouping: Labels
  from: number
  to: number
  uPlotCursor: uPlot.Cursor

  short: number
  long: number
  threshold: number
}

const BurnrateGraph = ({
  client,
  labels,
  grouping,
  from,
  to,
  short,
  long,
  threshold,
  uPlotCursor,
}: BurnrateGraphProps): JSX.Element => {
  const targetRef = useRef() as React.MutableRefObject<HTMLDivElement>

  const [burnrates, setBurnrates] = useState<AlignedData>()
  const [burnrateLabels, setBurnrateLabels] = useState<string[]>([])
  const [burnratesLoading, setBurnratesLoading] = useState<boolean>(true)
  const [width, setWidth] = useState<number>(500)

  const setWidthFromContainer = () => {
    if (targetRef !== undefined) {
      setWidth(targetRef.current.offsetWidth)
    }
  }

  // Set width on first render
  useLayoutEffect(setWidthFromContainer)
  // Set width on every window resize
  window.addEventListener('resize', setWidthFromContainer)

  useEffect(() => {
    setBurnratesLoading(true)

    const shortDuration = new Duration()
    shortDuration.seconds = BigInt(short)
    const longDuration = new Duration()
    longDuration.seconds = BigInt(long)

    client
      .graphBurnrates({
        expr: labelsString(labels),
        grouping: labelsString(grouping),
        start: Timestamp.fromDate(new Date(from)),
        end: Timestamp.fromDate(new Date(to)),
        short: shortDuration,
        long: longDuration,
      })
      .then((resp: GraphBurnratesResponse) => {
        let durationTimestamps: number[] = []
        const durationData: number[][] = []
        const durationLabels: string[] = []

        resp.timeseries.forEach((timeseries: Timeseries, i: number) => {
          const [x, ...series] = timeseries.series
          if (i === 0) {
            durationTimestamps = x.values
          }

          series.forEach((s: Series) => {
            durationData.push(s.values)
          })

          durationLabels.push(...timeseries.labels)
        })

        setBurnrates([durationTimestamps, ...durationData])
        setBurnrateLabels(durationLabels)
      })
      .catch((err) => {
        console.log(err)
        setBurnrates(undefined)
      })
      .finally(() => {
        setBurnratesLoading(false)
      })
  }, [client, labels, grouping, from, to, short, long])

  return (
    <>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
        <h4>
          {burnratesLoading ? (
            <Spinner
              animation="border"
              style={{
                marginLeft: '1rem',
                marginBottom: '0.5rem',
                width: '1rem',
                height: '1rem',
                borderWidth: '1px',
              }}
            />
          ) : (
            <></>
          )}
        </h4>
      </div>
      <div>
        <p></p>
      </div>

      <div ref={targetRef}>
        {burnrates !== undefined ? (
          <UplotReact
            options={{
              width: width,
              height: 150,
              padding: [15, 0, 0, 0],
              cursor: uPlotCursor,
              // focus: {alpha: 1}, // TODO: Dynamic focus
              series: [
                {},
                ...burnrateLabels.map((label: string, i: number): uPlot.Series => {
                  return {
                    min: 0,
                    stroke: `#${burnrate[i]}`,
                    label: parseLabelValue(label),
                    gaps: seriesGaps(from / 1000, to / 1000),
                  }
                }),
              ],
              scales: {
                x: {min: from / 1000, max: to / 1000},
                y: {
                  range: {
                    min: {hard: 0},
                    max: {hard: 1},
                  },
                },
              },
              axes: [{}, {}],
              hooks: {
                drawSeries: [
                  (u: uPlot, _: number) => {
                    if (threshold === undefined) {
                      return
                    }

                    const ctx = u.ctx
                    ctx.save()

                    const xd = u.data[0]
                    const x0 = u.valToPos(xd[0], 'x', true)
                    const x1 = u.valToPos(xd[xd.length - 1], 'x', true)
                    const y = u.valToPos(threshold, 'y', true)

                    ctx.beginPath()
                    ctx.strokeStyle = `#FF1744`
                    ctx.setLineDash([25, 10])
                    ctx.moveTo(x0, y)
                    ctx.lineTo(x1, y)
                    ctx.stroke()

                    ctx.restore()
                  },
                ],
              },
            }}
            data={burnrates}
          />
        ) : (
          <UplotReact
            options={{
              width: width,
              height: 150,
              padding: [15, 0, 0, 0],
              series: [{}, {}],
              scales: {
                x: {min: from / 1000, max: to / 1000},
                y: {min: 0, max: 1},
              },
            }}
            data={[[], []]}
          />
        )}
      </div>
    </>
  )
}

export default AlertsTable
