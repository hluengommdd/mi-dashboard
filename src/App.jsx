import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import Chart from 'chart.js/auto';
import './App.css';

const Toast = ({ message, type = 'info', duration = 4000 }) => {
    const [isVisible, setIsVisible] = useState(true);
    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(false), duration);
        return () => clearTimeout(timer);
    }, [duration]);
    if (!isVisible) return null;
    return (
        <div className={`toast toast-${type}`}>
            {type === 'error' && '❌'} {type === 'success' && '✅'} {type === 'info' && 'ℹ️'} {message}
        </div>
    );
};

const Tooltip = ({ text, children }) => {
    return <div className="tooltip-wrapper">{children}<span className="tooltip-text">{text}</span></div>;
};

const App = () => {
    // --- ESTADO ---
    const [loading, setLoading] = useState(true);
    const [teachersData, setTeachersData] = useState([]);
    const [evolucionDocente, setEvolucionDocente] = useState([]);
    const [currentView, setCurrentView] = useState('observacion');
    const [selectedObsId, setSelectedObsId] = useState('');
    const [selectedDocId, setSelectedDocId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [lastSync, setLastSync] = useState(null);
    const [syncStatus, setSyncStatus] = useState('🔄 Sincronizando...');
    const [toasts, setToasts] = useState([]);
    const [showGeneralAverage, setShowGeneralAverage] = useState(true);
    const [dateFilterFrom, setDateFilterFrom] = useState('');
    const [dateFilterTo, setDateFilterTo] = useState('');

    const formatObsDate = (dateString) => {
        if (!dateString) return '';
        const d = new Date(dateString);
        if (Number.isNaN(d.getTime())) return dateString;
        const day = `${d.getDate()}`.padStart(2, '0');
        const month = `${d.getMonth() + 1}`.padStart(2, '0');
        return `${day}/${month}`;
    };

    const showToast = (message, type = 'info') => {
        const id = Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    // Refs para los gráficos
    const radarChartRef = useRef(null);
    const detailedChartRef = useRef(null);
    const radarInst = useRef(null);
    const detailedInst = useRef(null);

    // --- POLLING INTELIGENTE ---
    const checkForNewData = async () => {
        try {
            const { data: latestData } = await supabase
                .from('respuestas')
                .select('timestamp')
                .order('timestamp', { ascending: false })
                .limit(1);

            if (!latestData || latestData.length === 0) return false;
            
            const latestTimestamp = new Date(latestData[0].timestamp);
            
            if (!lastSync || latestTimestamp > lastSync) {
                console.log('✅ NUEVOS DATOS detectados en Supabase');
                return true;
            }
            
            console.log('⏭️ Sin cambios en Supabase');
            return false;
        } catch (error) {
            console.error('Error verificando cambios:', error);
            showToast('Error al verificar cambios en Supabase', 'error');
            return false;
        }
    };

    // --- CARGA DE DATOS ---
    useEffect(() => {
        const loadAllData = async () => {
            try {
                setSyncStatus('🔄 Sincronizando...');
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

                setLastSync(new Date());
                setSyncStatus('✅ Sincronizado');
            } catch (error) {
                console.error("Error cargando datos:", error);
                setSyncStatus('❌ Error');
                showToast('No se pudieron cargar los datos. Verifica tu conexión.', 'error');
            } finally {
                setLoading(false);
            }
        };

        loadAllData();

        // Polling inteligente cada 30 segundos
        const interval = setInterval(async () => {
            const hasNewData = await checkForNewData();
            if (hasNewData) {
                await loadAllData();
            }
        }, 30000);

        return () => clearInterval(interval);
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

    const generalAverages = useMemo(() => calculateAverages(teachersData), [teachersData]);

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

    const filteredData = useMemo(() => {
        if (!dateFilterFrom && !dateFilterTo) return teachersData;
        return teachersData.filter(obs => {
            const obsDate = new Date(obs.fecha);
            const from = dateFilterFrom ? new Date(dateFilterFrom) : new Date(0);
            const to = dateFilterTo ? new Date(dateFilterTo) : new Date(9999, 11, 31);
            return obsDate >= from && obsDate <= to;
        });
    }, [teachersData, dateFilterFrom, dateFilterTo]);

    // --- ACTUALIZACIÓN DE GRÁFICOS ---
    useEffect(() => {
        if (!displayData) return;

        // Gráfico Radar Principal
        if (radarInst.current) radarInst.current.destroy();
        const radarDatasets = [];

        if (currentView !== 'general' && generalAverages && showGeneralAverage) {
            radarDatasets.push({
                label: 'Promedio General',
                data: [
                    generalAverages.puntos.ambiente,
                    generalAverages.puntos.interaccion,
                    generalAverages.puntos.organizacion
                ],
                backgroundColor: 'rgba(148, 163, 184, 0.1)',
                borderColor: 'rgba(100, 116, 139, 0.5)',
                pointBackgroundColor: 'rgba(148, 163, 184, 0.7)',
                borderWidth: 2,
                fill: true
            });
        }

        radarDatasets.push({
            label: currentView === 'observacion' ? 'Docente' : 'Puntaje (%)',
            data: [displayData.puntos.ambiente, displayData.puntos.interaccion, displayData.puntos.organizacion],
            backgroundColor: 'rgba(37, 99, 235, 0.15)',
            borderColor: '#2563eb',
            borderWidth: 2,
            pointBackgroundColor: '#2563eb'
        });

        radarInst.current = new Chart(radarChartRef.current, {
            type: 'radar',
            data: {
                labels: ['Ambiente', 'Interacción', 'Organización'],
                datasets: radarDatasets
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } } }
        });

        // Gráfico Detallado
        if (detailedInst.current) detailedInst.current.destroy();

        const generalByItem = (generalAverages?.items || []).reduce((acc, item) => {
            acc[item.nombre] = item.valor;
            return acc;
        }, {});

        const detailedDatasets = [];

        if (currentView !== 'general' && generalAverages && showGeneralAverage) {
            detailedDatasets.push({
                label: 'Promedio General',
                data: displayData.items.map(i => generalByItem[i.nombre] ?? null),
                backgroundColor: 'rgba(148, 163, 184, 0.08)',
                borderColor: 'rgba(100, 116, 139, 0.45)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(148, 163, 184, 0.7)',
                spanGaps: true,
                fill: true
            });
        }

        detailedDatasets.push({
            label: currentView === 'observacion' ? 'Docente' : 'Puntaje (%)',
            data: displayData.items.map(i => i.valor),
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderColor: '#8b5cf6',
            borderWidth: 2,
            pointBackgroundColor: '#8b5cf6'
        });

        detailedInst.current = new Chart(detailedChartRef.current, {
            type: 'radar',
            data: {
                labels: displayData.items.map(i => i.nombre.substring(0, 15) + '...'),
                datasets: detailedDatasets
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } } }
        });
    }, [displayData, currentView, generalAverages, showGeneralAverage]);

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
                {toasts.map((t) => <Toast key={t.id} message={t.message} type={t.type} />)}
                <div className="spinner"></div>
                <p style={{ marginTop: '15px', fontWeight: 600, color: 'var(--gray-700)' }}>Sincronizando con Supabase...</p>
            </div>
        );
    }

    return (
        <div className="app-container">
            {toasts.map((t) => <Toast key={t.id} message={t.message} type={t.type} />)}
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

                    <div className="sync-indicator">
                        <span className="sync-status">{syncStatus}</span>
                        {lastSync && (
                            <span className="sync-time">
                                {lastSync.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
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
                                        <option key={o.observacion_id} value={o.observacion_id}>
                                            {o.name} - {o.asignatura} ({formatObsDate(o.fecha)})
                                        </option>
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

                    <div className="filter-card" style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', display: 'block' }}>FILTROS AVANZADOS:</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Desde:</label>
                                <input 
                                    type="date" 
                                    value={dateFilterFrom} 
                                    onChange={(e) => setDateFilterFrom(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid rgba(148, 163, 184, 0.22)', marginTop: '4px', fontSize: '0.9rem' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Hasta:</label>
                                <input 
                                    type="date" 
                                    value={dateFilterTo} 
                                    onChange={(e) => setDateFilterTo(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid rgba(148, 163, 184, 0.22)', marginTop: '4px', fontSize: '0.9rem' }}
                                />
                            </div>
                        </div>
                        {(dateFilterFrom || dateFilterTo) && (
                            <button 
                                onClick={() => { setDateFilterFrom(''); setDateFilterTo(''); }}
                                style={{ 
                                    marginTop: '10px', 
                                    padding: '8px 12px', 
                                    background: 'var(--gray-200)', 
                                    color: 'var(--text-secondary)', 
                                    border: 'none', 
                                    borderRadius: '8px', 
                                    cursor: 'pointer', 
                                    fontSize: '0.8rem',
                                    fontWeight: 600
                                }}
                            >
                                ✕ Limpiar filtros
                            </button>
                        )}
                    </div>

                    <div className="kpi-row">
                        <Tooltip text="Promedio general de todas las dimensiones evaluadas">
                            <div className="kpi-card kpi-total">
                                <span className="kpi-label">Desempeño Global</span>
                                <span className="kpi-val">{Math.round(displayData?.porcentaje_total || 0)}%</span>
                            </div>
                        </Tooltip>
                        <Tooltip text="Evaluación del ambiente y clima del aula">
                            <div className="kpi-card kpi-ambiente">
                                <span className="kpi-label">Ambiente Aula</span>
                                <span className="kpi-val">{Math.round(displayData?.puntos.ambiente || 0)}%</span>
                            </div>
                        </Tooltip>
                        <Tooltip text="Calidad de la interacción docente-estudiante">
                            <div className="kpi-card kpi-interaccion">
                                <span className="kpi-label">Interacción</span>
                                <span className="kpi-val">{Math.round(displayData?.puntos.interaccion || 0)}%</span>
                            </div>
                        </Tooltip>
                        <Tooltip text="Estructura y organización de la clase">
                            <div className="kpi-card kpi-organizacion">
                                <span className="kpi-label">Organización</span>
                                <span className="kpi-val">{Math.round(displayData?.puntos.organizacion || 0)}%</span>
                            </div>
                        </Tooltip>
                        <Tooltip text="Tendencia de desempeño en el tiempo">
                            <div className="kpi-card kpi-tendencia">
                                <span className="kpi-label">Tendencia Docente</span>
                                <span className="kpi-val">{extraKPIs.tendencia}</span>
                            </div>
                        </Tooltip>
                        <Tooltip text="Dimensión con menor puntuación">
                            <div className="kpi-card kpi-critica">
                                <span className="kpi-label">Dimensión Crítica</span>
                                <span id="kpi-dimension-critica" className="kpi-val">{extraKPIs.critica}</span>
                            </div>
                        </Tooltip>
                        <Tooltip text="Indicadores por debajo del 60%">
                            <div className="kpi-card kpi-bajo">
                                <span className="kpi-label">Indicadores &lt; 60%</span>
                                <span className="kpi-val">{extraKPIs.bajo}</span>
                            </div>
                        </Tooltip>
                    </div>

                    <div className="charts-grid">
                        <div className="chart-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Comparativa de Dimensiones</h3>
                                {currentView !== 'general' && (
                                    <button 
                                        onClick={() => setShowGeneralAverage(!showGeneralAverage)}
                                        style={{
                                            padding: '6px 12px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            border: `2px solid ${showGeneralAverage ? 'var(--primary)' : 'var(--gray-300)'}`,
                                            background: showGeneralAverage ? 'var(--primary-lighter)' : 'transparent',
                                            color: showGeneralAverage ? 'var(--primary)' : 'var(--text-secondary)',
                                            borderRadius: '999px',
                                            cursor: 'pointer',
                                            transition: 'all 0.3s ease'
                                        }}
                                    >
                                        {showGeneralAverage ? '✓' : '○'} Promedio General
                                    </button>
                                )}
                            </div>
                            <div className="chart-container"><canvas ref={radarChartRef}></canvas></div>
                            <div style={{ marginTop: '1rem', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#2563eb' }}></div>
                                    <span style={{ color: 'var(--text-secondary)' }}>Datos actuales</span>
                                </div>
                                {showGeneralAverage && currentView !== 'general' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: 'rgba(100, 116, 139, 0.5)' }}></div>
                                        <span style={{ color: 'var(--text-secondary)' }}>Promedio General</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="chart-card">
                            <h3 style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>Indicadores Específicos</h3>
                            <div className="chart-container"><canvas ref={detailedChartRef}></canvas></div>
                            <div style={{ marginTop: '1rem', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#8b5cf6' }}></div>
                                    <span style={{ color: 'var(--text-secondary)' }}>Datos actuales</span>
                                </div>
                                {showGeneralAverage && currentView !== 'general' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: 'rgba(100, 116, 139, 0.45)' }}></div>
                                        <span style={{ color: 'var(--text-secondary)' }}>Promedio General</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="indicators-card">
                        <h3 style={{ fontSize: '1rem' }}>Análisis Detallado por Indicador</h3>
                        {!displayData?.items || displayData.items.length === 0 ? (
                            <div className="empty-state">
                                <p style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>📊 Sin indicadores</p>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Selecciona una observación para ver los datos detallados</p>
                            </div>
                        ) : (
                        <div className="ind-grid">
                            {displayData.items.map((i, idx) => {
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
                        )}
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
                                <div className="meta-item"><b>Fecha:</b> <span>{formatObsDate(displayData.fecha)}</span></div>
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