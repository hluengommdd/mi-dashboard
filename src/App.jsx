import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import Chart from 'chart.js/auto';
import './App.css';

const App = () => {
    // --- ESTADO ---
    const [loading, setLoading] = useState(true);
    const [teachersData, setTeachersData] = useState([]);
    const [evolucionDocente, setEvolucionDocente] = useState([]);
    const [currentView, setCurrentView] = useState('observacion');
    const [selectedObsId, setSelectedObsId] = useState('');
    const [selectedDocId, setSelectedDocId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    // Refs para los gráficos
    const radarChartRef = useRef(null);
    const detailedChartRef = useRef(null);
    const radarInst = useRef(null);
    const detailedInst = useRef(null);

    // --- CARGA DE DATOS ---
    useEffect(() => {
        const loadAllData = async () => {
            try {
                const [dRes, oRes, vDimRes, iRes, rRes, evoRes] = await Promise.all([
                    supabase.from('docentes').select('*'),
                    supabase.from('v_resultados_dimensiones').select('*'),
                    supabase.from('v_resultados_dimension').select('*'),
                    supabase.from('indicadores').select('*'),
                    supabase.from('respuestas').select('*'),
                    supabase.from('v_evolucion_docente').select('*')
                ]);

                const docsMap = new Map((dRes.data || []).map(d => [d.id, d.nombre]));
                const indicatorsRaw = iRes.data || [];
                setEvolucionDocente(evoRes.data || []);

                const mappedData = (oRes.data || []).map(obs => {
                    const dims = (vDimRes.data || []).filter(vd => vd.observacion_id === obs.observacion_id);
                    const resp = (rRes.data || []).filter(r => r.observacion_id === obs.observacion_id);

                    return {
                        ...obs,
                        name: docsMap.get(obs.docente_id) || 'Docente N/A',
                        puntos: {
                            ambiente: dims.find(d => d.dimension_codigo === 'AMBIENTE')?.porcentaje || 0,
                            interaccion: dims.find(d => d.dimension_codigo === 'INTERACCION')?.porcentaje || 0,
                            organizacion: dims.find(d => d.dimension_codigo === 'ORGANIZACION')?.porcentaje || 0
                        },
                        items: resp.map(r => {
                            const info = indicatorsRaw.find(i => i.id === r.indicador_id);
                            return {
                                nombre: info?.columna_excel || 'Indicador',
                                valor: r.valor * 100,
                                dimId: info?.dimension_id
                            };
                        })
                    };
                });

                setTeachersData(mappedData);
                if (mappedData.length > 0) setSelectedObsId(mappedData[0].observacion_id);
                
                // Set default docente for the average view
                const docsValidos = [...new Set(mappedData.map(o => o.docente_id))].filter(id => mappedData.filter(o => o.docente_id === id).length >= 2);
                if (docsValidos.length > 0) setSelectedDocId(docsValidos[0]);

            } catch (error) {
                console.error("Error cargando datos:", error);
            } finally {
                setLoading(false);
            }
        };

        loadAllData();
    }, []);

    // --- LÓGICA DE CÁLCULO ---
    const calculateAverages = (subset) => {
        if (!subset || subset.length === 0) return null;
        const result = {
            porcentaje_total: 0,
            puntos: { ambiente: 0, interaccion: 0, organizacion: 0 },
            items: []
        };

        subset.forEach(s => {
            result.porcentaje_total += s.porcentaje_total;
            result.puntos.ambiente += s.puntos.ambiente;
            result.puntos.interaccion += s.puntos.interaccion;
            result.puntos.organizacion += s.puntos.organizacion;
        });

        const n = subset.length;
        result.porcentaje_total /= n;
        result.puntos.ambiente /= n;
        result.puntos.interaccion /= n;
        result.puntos.organizacion /= n;

        const iMap = {};
        subset.forEach(s => s.items.forEach(i => {
            if (!iMap[i.nombre]) iMap[i.nombre] = { sum: 0, count: 0, dimId: i.dimId };
            iMap[i.nombre].sum += i.valor;
            iMap[i.nombre].count++;
        }));

        result.items = Object.keys(iMap).map(k => ({
            nombre: k,
            valor: iMap[k].sum / iMap[k].count,
            dimId: iMap[k].dimId
        }));

        return result;
    };

    const displayData = useMemo(() => {
        if (currentView === 'observacion') {
            return teachersData.find(o => o.observacion_id === selectedObsId);
        } else if (currentView === 'docente') {
            return calculateAverages(teachersData.filter(o => o.docente_id === selectedDocId));
        } else {
            return calculateAverages(teachersData);
        }
    }, [currentView, selectedObsId, selectedDocId, teachersData]);

    const extraKPIs = useMemo(() => {
        if (!displayData) return { critica: '—', bajo: 0, tendencia: '—' };

        const dims = [
            { n: 'Ambiente', v: displayData.puntos.ambiente },
            { n: 'Interacción', v: displayData.puntos.interaccion },
            { n: 'Organización', v: displayData.puntos.organizacion }
        ].sort((a, b) => a.v - b.v);

        let tendencia = '—';
        if (currentView === 'docente' && selectedDocId) {
            const serie = (evolucionDocente || [])
                .filter(e => e.docente_id === selectedDocId)
                .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

            if (serie.length >= 2) {
                const first = Number(serie[0].porcentaje_promedio || 0);
                const last = Number(serie[serie.length - 1].porcentaje_promedio || 0);
                const diff = last - first;
                if (diff > 0) tendencia = `📈 +${Math.round(diff)}%`;
                else if (diff < 0) tendencia = `📉 ${Math.round(diff)}%`;
                else tendencia = '➖ Estable';
            }
        }

        return {
            critica: `${dims[0].n} ${Math.round(dims[0].v)}%`,
            bajo: (displayData.items || []).filter(i => (i.valor ?? 0) < 60).length,
            tendencia
        };
    }, [displayData, currentView, selectedDocId, evolucionDocente]);

    const ranking = useMemo(() => {
        return [...teachersData].sort((a, b) => b.porcentaje_total - a.porcentaje_total).slice(0, 5);
    }, [teachersData]);

    // --- ACTUALIZACIÓN DE GRÁFICOS ---
    useEffect(() => {
        if (!displayData) return;

        // Gráfico Radar Principal
        if (radarInst.current) radarInst.current.destroy();
        radarInst.current = new Chart(radarChartRef.current, {
            type: 'radar',
            data: {
                labels: ['Ambiente', 'Interacción', 'Organización'],
                datasets: [{
                    label: 'Puntaje (%)',
                    data: [displayData.puntos.ambiente, displayData.puntos.interaccion, displayData.puntos.organizacion],
                    backgroundColor: 'rgba(37, 99, 235, 0.15)',
                    borderColor: '#2563eb',
                    borderWidth: 2,
                    pointBackgroundColor: '#2563eb'
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } } }
        });

        // Gráfico Detallado
        if (detailedInst.current) detailedInst.current.destroy();
        detailedInst.current = new Chart(detailedChartRef.current, {
            type: 'radar',
            data: {
                labels: displayData.items.map(i => i.nombre.substring(0, 15) + '...'),
                datasets: [{
                    label: 'Puntaje (%)',
                    data: displayData.items.map(i => i.valor),
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderColor: '#8b5cf6',
                    borderWidth: 2,
                    pointBackgroundColor: '#8b5cf6'
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } } }
        });
    }, [displayData]);

    // --- MANEJO DE BÚSQUEDA ---
    const handleSearch = (e) => {
        const term = e.target.value;
        setSearchTerm(term);
        const found = teachersData.find(o => 
            o.name.toLowerCase().includes(term.toLowerCase()) || 
            o.asignatura.toLowerCase().includes(term.toLowerCase())
        );
        if (found) {
            setSelectedObsId(found.observacion_id);
            setCurrentView('observacion');
        }
    };

    if (loading) {
        return (
            <div id="loadingOverlay">
                <div className="spinner"></div>
                <p style={{ marginTop: '15px', fontWeight: 600, color: 'var(--gray-700)' }}>Sincronizando con Supabase...</p>
            </div>
        );
    }

    return (
        <div className="app-container">
            <header className="app-header">
                <div className="header-wrap">
                    <div className="brand">
                        <img
                          src="/veritas.png"
                          alt="Escudo Veritas"
                          className="logo-veritas"
/>
                        <div>
                            <h1 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Gestión de Observación en Aula</h1>
                            <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>Análisis de Desempeño Académico</p>
                        </div>
                    </div>

                    <div className="search-container">
                        <span className="search-icon">🔍</span>
                        <input 
                            type="text" 
                            placeholder="Buscar por docente, asignatura o curso..."
                            value={searchTerm}
                            onChange={handleSearch}
                        />
                    </div>

                    <div className="view-toggle">
                        <button className={`view-btn ${currentView === 'observacion' ? 'active' : ''}`} onClick={() => setCurrentView('observacion')}>Individual</button>
                        <button className={`view-btn ${currentView === 'docente' ? 'active' : ''}`} onClick={() => setCurrentView('docente')}>Promedios</button>
                        <button className={`view-btn ${currentView === 'general' ? 'active' : ''}`} onClick={() => setCurrentView('general')}>General</button>
                    </div>
                </div>
            </header>

            <main className="main-content">
                <div className="content-area">
                    <div className="filter-card">
                        {currentView === 'observacion' && (
                            <div id="wrapper-observacion">
                                <label style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', display: 'block' }}>REGISTRO DE OBSERVACIÓN:</label>
                                <select value={selectedObsId} onChange={(e) => setSelectedObsId(e.target.value)}>
                                    {teachersData.map(o => (
                                        <option key={o.observacion_id} value={o.observacion_id}>{o.name} - {o.asignatura} ({o.fecha})</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {currentView === 'docente' && (
                            <div id="wrapper-docente">
                                <label style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', display: 'block' }}>PROMEDIO POR DOCENTE (Mínimo 2 observaciones):</label>
                                <select value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)}>
                                    {[...new Set(teachersData.map(o => o.docente_id))]
                                        .filter(id => teachersData.filter(o => o.docente_id === id).length >= 2)
                                        .map(id => (
                                            <option key={id} value={id}>{teachersData.find(o => o.docente_id === id).name}</option>
                                        ))
                                    }
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="kpi-row">
                        <div className="kpi-card kpi-total">
                            <span className="kpi-label">Desempeño Global</span>
                            <span className="kpi-val">{Math.round(displayData?.porcentaje_total || 0)}%</span>
                        </div>
                        <div className="kpi-card kpi-ambiente">
                            <span className="kpi-label">Ambiente Aula</span>
                            <span className="kpi-val">{Math.round(displayData?.puntos.ambiente || 0)}%</span>
                        </div>
                        <div className="kpi-card kpi-interaccion">
                            <span className="kpi-label">Interacción</span>
                            <span className="kpi-val">{Math.round(displayData?.puntos.interaccion || 0)}%</span>
                        </div>
                        <div className="kpi-card kpi-organizacion">
                            <span className="kpi-label">Organización</span>
                            <span className="kpi-val">{Math.round(displayData?.puntos.organizacion || 0)}%</span>
                        </div>
                        <div className="kpi-card kpi-tendencia">
                            <span className="kpi-label">Tendencia Docente</span>
                            <span className="kpi-val">{extraKPIs.tendencia}</span>
                        </div>
                        <div className="kpi-card kpi-critica">
                            <span className="kpi-label">Dimensión Crítica</span>
                            <span id="kpi-dimension-critica" className="kpi-val">{extraKPIs.critica}</span>
                        </div>
                        <div className="kpi-card kpi-bajo">
                            <span className="kpi-label">Indicadores &lt; 60%</span>
                            <span className="kpi-val">{extraKPIs.bajo}</span>
                        </div>
                    </div>

                    <div className="charts-grid">
                        <div className="chart-card">
                            <h3 style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>Comparativa de Dimensiones</h3>
                            <div className="chart-container"><canvas ref={radarChartRef}></canvas></div>
                        </div>
                        <div className="chart-card">
                            <h3 style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>Indicadores Específicos</h3>
                            <div className="chart-container"><canvas ref={detailedChartRef}></canvas></div>
                        </div>
                    </div>

                    <div className="indicators-card">
                        <h3 style={{ fontSize: '1rem' }}>Análisis Detallado por Indicador</h3>
                        <div className="ind-grid">
                            {displayData?.items.map((i, idx) => {
                                const color = i.dimId === 1 ? 'var(--success)' : i.dimId === 2 ? 'var(--purple)' : 'var(--orange)';
                                return (
                                    <div key={idx} className="ind-item">
                                        <div className="ind-info">
                                            <span style={{ maxWidth: '80%' }}>{i.nombre}</span>
                                            <span style={{ color: color }}>{Math.round(i.valor)}%</span>
                                        </div>
                                        <div className="progress-track">
                                            <div className="progress-fill" style={{ width: `${i.valor}%`, background: color }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <aside className="sidebar">
                    <div className="side-card">
                        <h3 style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>Detalles de la Vista</h3>
                        {currentView === 'observacion' && displayData ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div className="meta-item"><b>Docente:</b> <span>{displayData.name}</span></div>
                                <div className="meta-item"><b>Asignatura:</b> <span>{displayData.asignatura}</span></div>
                                <div className="meta-item"><b>Curso:</b> <span>{displayData.curso}</span></div>
                                <div className="meta-item"><b>Fecha:</b> <span>{displayData.fecha}</span></div>
                                <div className="meta-item"><b>Observador:</b> <span>{displayData.observador}</span></div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--primary)', fontWeight: 700, padding: '10px' }}>
                                {currentView === 'docente' ? "Promedio Histórico Docente" : "Promedio General Institucional"}
                            </div>
                        )}
                    </div>

                    <div className="side-card">
                        <h3 style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>Top Desempeños</h3>
                        <div id="rankingList">
                            {ranking.map((s, i) => (
                                <div key={s.observacion_id} className="rank-item">
                                    <div className={`rank-badge ${i === 0 ? 'rank-top' : ''}`}>{i + 1}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{s.name}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--gray-600)' }}>{s.asignatura}</div>
                                    </div>
                                    <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.9rem' }}>{Math.round(s.porcentaje_total)}%</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    );
};

export default App;