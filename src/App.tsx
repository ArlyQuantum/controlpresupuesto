import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Wallet,
  PieChart,
  Calendar,
  Utensils,
  Fuel,
  Receipt,
  ShoppingBag,
  History,
  BarChart3,
  Settings as SettingsIcon,
  Plus,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  Edit3,
  ChevronRight,
  Info,
  ShieldAlert,
  Sparkles,
  Check,
  X,
  Menu,
  FlaskConical,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  Unlock,
  HelpCircle,
  FileSpreadsheet,
  FileJson
} from 'lucide-react';

// ==========================================
// 1. DEFINICIÓN DE TIPOS Y MODELO DE DATOS
// ==========================================

type MovementType = 'ingreso' | 'gasto' | 'reserva' | 'liberacion' | 'transferencia' | 'ajuste';
type IncomeStatus = 'recibido' | 'previsto';
type BillStatus = 'pendiente' | 'reservado' | 'pagado' | 'vencido';
type FoodPurchaseType = 'Desayuno' | 'Almuerzo' | 'Cena' | 'Merienda' | 'Compra general' | 'Otros';

interface Income {
  id: string;
  source: string;
  amount: number;
  date: string;
  expectedDate: string;
  frequency: 'mensual' | 'semanal' | 'unico';
  status: IncomeStatus;
  weekId: string;
  notes?: string;
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  categoryId: string;
  paymentMethod: string;
  weekId: string;
  notes?: string;
  paidFromReserve: boolean; // Si se pagó usando el sobre/reserva o directo del saldo libre
  // Campos extra para Alimentación
  merchant?: string;
  foodType?: FoodPurchaseType;
  // Campos extra para Combustible
  fuelLogId?: string;
  // Campos extra para Factura
  billId?: string;
}

interface BudgetCategory {
  id: string;
  name: string;
  monthlyLimit: number;
  color: string;
  type: 'fijo' | 'variable' | 'cotidiano';
  active: boolean;
}

interface Envelope {
  id: string;
  categoryId: string;
  allocatedAmount: number; // Total asignado/reservado históricamente en el ciclo
  spentAmount: number;     // Total gastado en esta categoría
  reservedAmount: number;  // Reserva vigente disponible en el sobre ahora mismo
  remainingAmount: number; // Alias de reservedAmount (lo que queda en el sobre)
}

interface Reservation {
  id: string;
  categoryId: string;
  amount: number;
  date: string;
  status: 'activa' | 'consumida' | 'liberada';
  description: string;
}

interface Transfer {
  id: string;
  sourceEnvelopeId: string; // 'libre' o categoryId
  destinationEnvelopeId: string; // 'libre' o categoryId
  amount: number;
  date: string;
  notes: string;
}

interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  status: BillStatus;
  paymentDate?: string;
  paymentMethod?: string;
  receiptNote?: string;
  categoryId: string;
}

interface FuelLog {
  id: string;
  date: string;
  gallons: number;
  pricePerGallon: number;
  total: number;
  odometer?: number;
  notes?: string;
  weekId: string;
  expenseId: string;
}

interface WeeklyPeriod {
  id: string;
  label: string;
  startDate: string; // Jueves
  endDate: string;   // Miércoles
}

interface LedgerRecord {
  id: string;
  date: string;
  type: MovementType;
  description: string;
  amount: number;
  categoryId?: string;
  weekId: string;
  referenceId?: string;
  notes?: string;
}

interface HouseholdSettings {
  currency: string;
  householdSize: number;
  monthlyIncome: number;
  weeklyIncome: number;
  incomeDay: string;
  monthlyFoodBudget: number;
  fuelPrice: number;
  currentSystemDate: string;
  theme: 'dark';
}

interface AppState {
  settings: HouseholdSettings;
  categories: BudgetCategory[];
  incomes: Income[];
  expenses: Expense[];
  envelopes: Envelope[];
  reservations: Reservation[];
  transfers: Transfer[];
  bills: Bill[];
  fuelLogs: FuelLog[];
  ledger: LedgerRecord[];
}

// ==========================================
// 2. UTILIDADES MATEMÁTICAS Y FORMATO
// ==========================================

const roundDOP = (num: number): number => Math.round((num + Number.EPSILON) * 100) / 100;

const formatDOP = (amount: number, showDecimals = false): string => {
  const safeAmount = isNaN(amount) ? 0 : amount;
  const hasCents = Math.abs(safeAmount % 1) > 0.001;
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    minimumFractionDigits: showDecimals || hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
    .format(safeAmount)
    .replace('DOP', 'RD$')
    .trim();
};

const WEEKLY_PERIODS: WeeklyPeriod[] = [
  { id: 'W1', label: 'Semana 1 (Jue 5 Nov - Mié 11 Nov)', startDate: '2026-11-05', endDate: '2026-11-11' },
  { id: 'W2', label: 'Semana 2 (Jue 12 Nov - Mié 18 Nov)', startDate: '2026-11-12', endDate: '2026-11-18' },
  { id: 'W3', label: 'Semana 3 (Jue 19 Nov - Mié 25 Nov)', startDate: '2026-11-19', endDate: '2026-11-25' },
  { id: 'W4', label: 'Semana 4 (Jue 26 Nov - Mié 2 Dic)', startDate: '2026-11-26', endDate: '2026-12-02' },
];

const getWeekIdForDate = (dateStr: string): string => {
  for (const w of WEEKLY_PERIODS) {
    if (dateStr >= w.startDate && dateStr <= w.endDate) return w.id;
  }
  if (dateStr < '2026-11-05') return 'W1';
  return 'W4';
};

const getDaysUntilNextThursday = (currentDateStr: string): { nextThursday: string; daysRemaining: number } => {
  const curr = new Date(currentDateStr + 'T12:00:00');
  const dayOfWeek = curr.getDay(); // 0 Dom, 4 Jue
  let daysToAdd = (4 - dayOfWeek + 7) % 7;
  if (daysToAdd === 0) daysToAdd = 7; // Si hoy es jueves, el próximo jueves es en 7 días
  const nextThu = new Date(curr);
  nextThu.setDate(curr.getDate() + daysToAdd);
  const yyyy = nextThu.getFullYear();
  const mm = String(nextThu.getMonth() + 1).padStart(2, '0');
  const dd = String(nextThu.getDate()).padStart(2, '0');
  return { nextThursday: `${yyyy}-${mm}-${dd}`, daysRemaining: daysToAdd };
};

// ==========================================
// 3. ESTADO INICIAL EXACTO (5 NOVIEMBRE 2026)
// ==========================================

const createInitialState = (): AppState => {
  const categories: BudgetCategory[] = [
    { id: 'cat-food', name: 'Alimentación', monthlyLimit: 10000, color: '#A78BFA', type: 'variable', active: true },
    { id: 'cat-elec', name: 'Electricidad', monthlyLimit: 1500, color: '#C4B5FD', type: 'fijo', active: true },
    { id: 'cat-water', name: 'Agua', monthlyLimit: 1000, color: '#6EE7B7', type: 'fijo', active: true },
    { id: 'cat-net', name: 'Internet', monthlyLimit: 1590, color: '#A7F3D0', type: 'fijo', active: true },
    { id: 'cat-gas', name: 'Gas de cocinar', monthlyLimit: 850, color: '#FBBF24', type: 'variable', active: true },
    { id: 'cat-kids', name: 'Gastos de los hijos', monthlyLimit: 2000, color: '#A78BFA', type: 'variable', active: true },
    { id: 'cat-family', name: 'Apoyo familiar', monthlyLimit: 1000, color: '#C4B5FD', type: 'fijo', active: true },
    { id: 'cat-occasional', name: 'Gastos ocasionales', monthlyLimit: 1000, color: '#9292A3', type: 'variable', active: true },
    { id: 'cat-fuel', name: 'Combustible', monthlyLimit: 3800, color: '#6EE7B7', type: 'variable', active: true },
    { id: 'cat-foreign', name: 'Gastos foráneos', monthlyLimit: 0, color: '#F87171', type: 'cotidiano', active: true },
  ];

  const incomes: Income[] = [
    {
      id: 'inc-1',
      source: 'Ingreso mensual recibido',
      amount: 10000,
      date: '2026-11-05',
      expectedDate: '2026-11-02',
      frequency: 'mensual',
      status: 'recibido',
      weekId: 'W1',
      notes: 'Ingreso base mensual confirmado al iniciar el sistema el 5 de noviembre.'
    },
    {
      id: 'inc-2',
      source: 'Aporte semanal recibido (Jueves 5 Nov)',
      amount: 3500,
      date: '2026-11-05',
      expectedDate: '2026-11-05',
      frequency: 'semanal',
      status: 'recibido',
      weekId: 'W1',
      notes: 'Primer aporte semanal de noviembre recibido.'
    },
    {
      id: 'inc-3',
      source: 'Aporte semanal (2do Jueves)',
      amount: 3500,
      date: '2026-11-12',
      expectedDate: '2026-11-12',
      frequency: 'semanal',
      status: 'previsto',
      weekId: 'W2',
      notes: 'Programado - No suma al saldo disponible hasta confirmar recepción.'
    },
    {
      id: 'inc-4',
      source: 'Aporte semanal (3er Jueves)',
      amount: 3500,
      date: '2026-11-19',
      expectedDate: '2026-11-19',
      frequency: 'semanal',
      status: 'previsto',
      weekId: 'W3',
      notes: 'Programado - No suma al saldo disponible hasta confirmar recepción.'
    },
    {
      id: 'inc-5',
      source: 'Aporte semanal (4to Jueves)',
      amount: 3500,
      date: '2026-11-26',
      expectedDate: '2026-11-26',
      frequency: 'semanal',
      status: 'previsto',
      weekId: 'W4',
      notes: 'Programado - No suma al saldo disponible hasta confirmar recepción.'
    }
  ];

  // Sobres iniciales según la distribución inicial del 5 de noviembre de 2026:
  // Electricidad: 1,500 | Agua: 1,000 | Internet: 1,590 | Combustible: 1,000 | Alimentación: 5,500 = 10,590
  const envelopes: Envelope[] = [
    { id: 'env-food', categoryId: 'cat-food', allocatedAmount: 5500, spentAmount: 0, reservedAmount: 5500, remainingAmount: 5500 },
    { id: 'env-elec', categoryId: 'cat-elec', allocatedAmount: 1500, spentAmount: 0, reservedAmount: 1500, remainingAmount: 1500 },
    { id: 'env-water', categoryId: 'cat-water', allocatedAmount: 1000, spentAmount: 0, reservedAmount: 1000, remainingAmount: 1000 },
    { id: 'env-net', categoryId: 'cat-net', allocatedAmount: 1590, spentAmount: 0, reservedAmount: 1590, remainingAmount: 1590 },
    { id: 'env-gas', categoryId: 'cat-gas', allocatedAmount: 0, spentAmount: 0, reservedAmount: 0, remainingAmount: 0 },
    { id: 'env-kids', categoryId: 'cat-kids', allocatedAmount: 0, spentAmount: 0, reservedAmount: 0, remainingAmount: 0 },
    { id: 'env-family', categoryId: 'cat-family', allocatedAmount: 0, spentAmount: 0, reservedAmount: 0, remainingAmount: 0 },
    { id: 'env-occasional', categoryId: 'cat-occasional', allocatedAmount: 0, spentAmount: 0, reservedAmount: 0, remainingAmount: 0 },
    { id: 'env-fuel', categoryId: 'cat-fuel', allocatedAmount: 1000, spentAmount: 0, reservedAmount: 1000, remainingAmount: 1000 },
    { id: 'env-foreign', categoryId: 'cat-foreign', allocatedAmount: 0, spentAmount: 0, reservedAmount: 0, remainingAmount: 0 },
  ];

  const reservations: Reservation[] = [
    { id: 'res-1', categoryId: 'cat-elec', amount: 1500, date: '2026-11-05', status: 'activa', description: 'Reserva para factura de Electricidad' },
    { id: 'res-2', categoryId: 'cat-water', amount: 1000, date: '2026-11-05', status: 'activa', description: 'Reserva para factura de Agua' },
    { id: 'res-3', categoryId: 'cat-net', amount: 1590, date: '2026-11-05', status: 'activa', description: 'Reserva para factura de Internet' },
    { id: 'res-4', categoryId: 'cat-fuel', amount: 1000, date: '2026-11-05', status: 'activa', description: 'Reserva de Combustible hasta el jueves siguiente' },
    { id: 'res-5', categoryId: 'cat-food', amount: 5500, date: '2026-11-05', status: 'activa', description: 'Primera asignación para Alimentación' },
  ];

  // Facturas pendientes pero con su dinero ya reservado (NO marcadas como pagadas automáticamente)
  const bills: Bill[] = [
    { id: 'bill-elec', name: 'Electricidad (EDE)', amount: 1500, dueDate: '2026-11-15', status: 'reservado', categoryId: 'cat-elec', receiptNote: 'Dinero apartado en sobre' },
    { id: 'bill-water', name: 'Agua Potable (CAASD)', amount: 1000, dueDate: '2026-11-18', status: 'reservado', categoryId: 'cat-water', receiptNote: 'Dinero apartado en sobre' },
    { id: 'bill-net', name: 'Internet Residencial', amount: 1590, dueDate: '2026-11-20', status: 'reservado', categoryId: 'cat-net', receiptNote: 'Dinero apartado en sobre' },
  ];

  const ledger: LedgerRecord[] = [
    { id: 'led-1', date: '2026-11-05', type: 'ingreso', description: 'Ingreso mensual recibido', amount: 10000, weekId: 'W1', referenceId: 'inc-1' },
    { id: 'led-2', date: '2026-11-05', type: 'ingreso', description: 'Aporte semanal recibido (Jueves)', amount: 3500, weekId: 'W1', referenceId: 'inc-2' },
    { id: 'led-3', date: '2026-11-05', type: 'reserva', description: 'Reserva inicial: Electricidad', amount: 1500, categoryId: 'cat-elec', weekId: 'W1', referenceId: 'res-1' },
    { id: 'led-4', date: '2026-11-05', type: 'reserva', description: 'Reserva inicial: Agua', amount: 1000, categoryId: 'cat-water', weekId: 'W1', referenceId: 'res-2' },
    { id: 'led-5', date: '2026-11-05', type: 'reserva', description: 'Reserva inicial: Internet', amount: 1590, categoryId: 'cat-net', weekId: 'W1', referenceId: 'res-3' },
    { id: 'led-6', date: '2026-11-05', type: 'reserva', description: 'Reserva inicial: Combustible hasta el próximo jueves', amount: 1000, categoryId: 'cat-fuel', weekId: 'W1', referenceId: 'res-4' },
    { id: 'led-7', date: '2026-11-05', type: 'reserva', description: 'Primera asignación: Alimentación', amount: 5500, categoryId: 'cat-food', weekId: 'W1', referenceId: 'res-5' },
  ];

  return {
    settings: {
      currency: 'DOP',
      householdSize: 5,
      monthlyIncome: 10000,
      weeklyIncome: 3500,
      incomeDay: 'Jueves',
      monthlyFoodBudget: 10000,
      fuelPrice: 317.50,
      currentSystemDate: '2026-11-05',
      theme: 'dark'
    },
    categories,
    incomes,
    expenses: [],
    envelopes,
    reservations,
    transfers: [],
    bills,
    fuelLogs: [],
    ledger
  };
};

const STORAGE_KEY = 'mi_balance_v1_state';

// ==========================================
// 4. COMPONENTE PRINCIPAL DE LA APLICACIÓN
// ==========================================

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.settings && parsed.categories) return parsed;
      }
    } catch (e) {
      console.error('Error leyendo localStorage:', e);
    }
    return createInitialState();
  });

  const [activeTab, setActiveTab] = useState<string>('resumen');
  const [selectedWeekId, setSelectedWeekId] = useState<string>('W1');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Modales rápidos
  const [activeModal, setActiveModal] = useState<
    | null
    | 'gasto'
    | 'comida'
    | 'gasolina'
    | 'ingreso'
    | 'modificarIngresos'
    | 'repartirExcedente'
    | 'reserva'
    | 'transferencia'
    | 'pruebas'
    | 'confirmReset'
  >(null);

  // Estado para el Asistente Inteligente de Reparto de Ingreso Extra
  const [surplusContext, setSurplusContext] = useState<{
    extraAmount: number;
    sourceTitle: string;
    allocations: Record<string, number>;
  } | null>(null);

  // Notificación / Toast discreto
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Error guardando estado en localStorage:', e);
    }
  }, [state]);

  // ==========================================
  // 5. MOTOR DE CÁLCULOS FINANCIEROS CENTRAL
  // ==========================================

  const metrics = useMemo(() => {
    // 1. Total de ingresos confirmados como recibidos
    const totalReceivedIncome = roundDOP(
      state.incomes
        .filter((inc) => inc.status === 'recibido')
        .reduce((acc, inc) => acc + inc.amount, 0)
    );

    // 2. Total de ingresos previstos (pendientes de recibir)
    const totalScheduledIncome = roundDOP(
      state.incomes
        .filter((inc) => inc.status === 'previsto')
        .reduce((acc, inc) => acc + inc.amount, 0)
    );

    // 3. Total de gastos pagados en el mes
    const totalSpent = roundDOP(
      state.expenses.reduce((acc, exp) => acc + exp.amount, 0)
    );

    // 4. Saldo Real en Caja (Efectivo físico/bancario total = Recibido - Gastado)
    const realCashBalance = roundDOP(totalReceivedIncome - totalSpent);

    // 5. Total Reservado vigente en Sobres
    const totalReservedInEnvelopes = roundDOP(
      state.envelopes.reduce((acc, env) => acc + env.reservedAmount, 0)
    );

    // 6. Dinero Libre sin Asignar (Saldo Real - Reservas vigentes)
    // Nota: Al inicio es 13,500 - 10,590 = 2,910.
    const unallocatedAvailable = roundDOP(realCashBalance - totalReservedInEnvelopes);

    // 7. Presupuesto Mensual Total vs Ingreso de Referencia (4 jueves = 24,000)
    const totalMonthlyBudget = roundDOP(
      state.categories.reduce((acc, cat) => acc + cat.monthlyLimit, 0)
    );
    const referenceMonthlyIncome = roundDOP(
      state.settings.monthlyIncome + state.settings.weeklyIncome * 4
    );
    const theoreticalMargin = roundDOP(referenceMonthlyIncome - totalMonthlyBudget);

    // 8. Total Asignado actual vs Pendiente de Asignar del presupuesto mensual (22,740)
    const totalAllocatedSoFar = roundDOP(
      state.envelopes.reduce((acc, env) => acc + env.allocatedAmount, 0)
    );
    const pendingMonthlyAllocation = roundDOP(
      Math.max(0, totalMonthlyBudget - totalAllocatedSoFar)
    );

    // 9. Próximo ingreso y días hasta el jueves
    const { nextThursday, daysRemaining } = getDaysUntilNextThursday(state.settings.currentSystemDate);
    const nextScheduledIncome = state.incomes
      .filter((i) => i.status === 'previsto')
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0];

    // 10. Sobres de Alimentación y Combustible
    const foodEnvelope = state.envelopes.find((e) => e.categoryId === 'cat-food') || {
      allocatedAmount: 5500,
      spentAmount: 0,
      reservedAmount: 5500,
      remainingAmount: 5500
    };
    const fuelEnvelope = state.envelopes.find((e) => e.categoryId === 'cat-fuel') || {
      allocatedAmount: 1000,
      spentAmount: 0,
      reservedAmount: 1000,
      remainingAmount: 1000
    };

    // 11. ¿Cuánto dinero puedo gastar hoy?
    // Basado en el dinero libre sin asignar (o disponible flexible) dividido entre los días que faltan para el jueves
    const safeDailyFreeSpend = roundDOP(Math.max(0, unallocatedAvailable) / Math.max(1, daysRemaining));
    const safeDailyFoodSpend = roundDOP(Math.max(0, foodEnvelope.reservedAmount) / Math.max(1, daysRemaining));

    return {
      totalReceivedIncome,
      totalScheduledIncome,
      totalSpent,
      realCashBalance,
      totalReservedInEnvelopes,
      unallocatedAvailable,
      totalMonthlyBudget,
      referenceMonthlyIncome,
      theoreticalMargin,
      totalAllocatedSoFar,
      pendingMonthlyAllocation,
      nextThursday,
      daysRemaining,
      nextScheduledIncome,
      foodEnvelope,
      fuelEnvelope,
      safeDailyFreeSpend,
      safeDailyFoodSpend
    };
  }, [state]);

  // ==========================================
  // 6. ACCIONES Y REGLAS DE NEGOCIO
  // ==========================================

  const getCategoryName = (catId?: string) => {
    if (!catId) return 'General';
    if (catId === 'libre') return 'Saldo Libre Disponible';
    return state.categories.find((c) => c.id === catId)?.name || 'Sin categoría';
  };

  // Registrar un gasto (General, Alimentación, Combustible, Cotidiano o Pago de Factura)
  const handleAddExpense = (params: {
    description: string;
    amount: number;
    date: string;
    categoryId: string;
    paymentMethod: string;
    notes?: string;
    useReserve?: boolean; // Si true, descuenta de la reserva de la categoría (hasta donde alcance)
    merchant?: string;
    foodType?: FoodPurchaseType;
    billId?: string;
    fuelData?: { gallons: number; pricePerGallon: number; odometer?: number };
  }) => {
    const cleanAmount = roundDOP(Number(params.amount));
    if (cleanAmount <= 0 || isNaN(cleanAmount)) {
      showToast('El importe debe ser mayor que RD$0', 'error');
      return false;
    }

    const weekId = getWeekIdForDate(params.date);
    const expenseId = 'exp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const fuelLogId = params.fuelData ? 'fuel-' + Date.now() : undefined;

    setState((prev) => {
      const targetEnv = prev.envelopes.find((e) => e.categoryId === params.categoryId);
      const currentReserve = targetEnv ? targetEnv.reservedAmount : 0;

      // Si el usuario elige usar la reserva del sobre (por defecto sí cuando hay reserva en ese sobre)
      const shouldUseReserve = params.useReserve !== undefined ? params.useReserve : currentReserve > 0;
      const deductedFromReserve = shouldUseReserve ? roundDOP(Math.min(currentReserve, cleanAmount)) : 0;

      const updatedEnvelopes = prev.envelopes.map((env) => {
        if (env.categoryId !== params.categoryId) return env;
        const newSpent = roundDOP(env.spentAmount + cleanAmount);
        const newReserved = roundDOP(Math.max(0, env.reservedAmount - deductedFromReserve));
        return {
          ...env,
          spentAmount: newSpent,
          reservedAmount: newReserved,
          remainingAmount: newReserved,
        };
      });

      // Si es pago de factura, actualizar estado de la factura y reserva asociada
      const updatedBills = prev.bills.map((bill) => {
        if (params.billId && bill.id === params.billId) {
          return {
            ...bill,
            status: 'pagado' as BillStatus,
            paymentDate: params.date,
            paymentMethod: params.paymentMethod,
            amount: cleanAmount,
          };
        }
        return bill;
      });

      const newExpense: Expense = {
        id: expenseId,
        description: params.description.trim(),
        amount: cleanAmount,
        date: params.date,
        categoryId: params.categoryId,
        paymentMethod: params.paymentMethod,
        weekId,
        notes: params.notes,
        paidFromReserve: deductedFromReserve > 0,
        merchant: params.merchant,
        foodType: params.foodType,
        billId: params.billId,
        fuelLogId,
      };

      const updatedFuelLogs = [...prev.fuelLogs];
      if (params.fuelData && fuelLogId) {
        updatedFuelLogs.unshift({
          id: fuelLogId,
          date: params.date,
          gallons: roundDOP(params.fuelData.gallons),
          pricePerGallon: roundDOP(params.fuelData.pricePerGallon),
          total: cleanAmount,
          odometer: params.fuelData.odometer,
          notes: params.notes,
          weekId,
          expenseId,
        });
      }

      const newLedger: LedgerRecord = {
        id: 'led-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
        date: params.date,
        type: 'gasto',
        description: params.description.trim(),
        amount: cleanAmount,
        categoryId: params.categoryId,
        weekId,
        referenceId: expenseId,
        notes: deductedFromReserve > 0
          ? `Cubierto con sobre/reserva (${formatDOP(deductedFromReserve)})`
          : 'Descontado de Saldo Libre Disponible',
      };

      return {
        ...prev,
        expenses: [newExpense, ...prev.expenses],
        envelopes: updatedEnvelopes,
        bills: updatedBills,
        fuelLogs: updatedFuelLogs,
        ledger: [newLedger, ...prev.ledger],
      };
    });

    showToast(`Gasto registrado: ${params.description} (${formatDOP(cleanAmount)})`, 'success');
    return true;
  };

  // Confirmar un ingreso previsto o agregar un ingreso nuevo
  const handleConfirmPlannedIncome = (incomeId: string) => {
    const target = state.incomes.find((i) => i.id === incomeId);
    if (!target || target.status === 'recibido') return;

    setState((prev) => {
      const updatedIncomes = prev.incomes.map((inc) =>
        inc.id === incomeId ? { ...inc, status: 'recibido' as IncomeStatus, date: inc.expectedDate } : inc
      );

      const newLedger: LedgerRecord = {
        id: 'led-' + Date.now(),
        date: target.expectedDate,
        type: 'ingreso',
        description: `Ingreso confirmado: ${target.source}`,
        amount: target.amount,
        weekId: target.weekId,
        referenceId: target.id,
      };

      return {
        ...prev,
        incomes: updatedIncomes,
        ledger: [newLedger, ...prev.ledger],
      };
    });
    showToast('Ingreso confirmado y sumado al Saldo Real Disponible', 'success');
    openSurplusAssistant(target.amount, `Confirmación: ${target.source}`);
  };

  // Construye una propuesta inteligente para repartir un ingreso extra entre sobres con asignación pendiente
  const buildSmartProposal = (extraAmount: number, currentCategories = state.categories, currentEnvelopes = state.envelopes) => {
    let remainingToSuggest = roundDOP(extraAmount);
    const priorityOrder = ['cat-food', 'cat-fuel', 'cat-gas', 'cat-kids', 'cat-family', 'cat-occasional', 'cat-elec', 'cat-water', 'cat-net'];
    const proposal: Record<string, number> = {};

    currentCategories.forEach((c) => {
      proposal[c.id] = 0;
    });

    priorityOrder.forEach((catId) => {
      if (remainingToSuggest <= 0) return;
      const cat = currentCategories.find((c) => c.id === catId);
      const env = currentEnvelopes.find((e) => e.categoryId === catId);
      if (!cat || !env) return;
      const pendingForGoal = roundDOP(Math.max(0, cat.monthlyLimit - env.allocatedAmount));
      if (pendingForGoal > 0) {
        const assign = roundDOP(Math.min(remainingToSuggest, pendingForGoal));
        proposal[catId] = assign;
        remainingToSuggest = roundDOP(remainingToSuggest - assign);
      }
    });

    return proposal;
  };

  const openSurplusAssistant = (extraAmount: number, sourceTitle: string) => {
    const cleanExtra = roundDOP(extraAmount);
    if (cleanExtra <= 0) return;
    const proposal = buildSmartProposal(cleanExtra);
    setSurplusContext({
      extraAmount: cleanExtra,
      sourceTitle,
      allocations: proposal,
    });
    setActiveModal('repartirExcedente');
  };

  // Nivel 1: Modificar parámetros de ingresos base (Mensual y Semanal de los jueves hacia adelante)
  const handleUpdateBaseIncomes = (newMonthlyBase: number, newWeeklyBase: number, syncPlannedThursdays: boolean) => {
    const cleanMonthly = roundDOP(newMonthlyBase);
    const cleanWeekly = roundDOP(newWeeklyBase);
    if (cleanMonthly < 0 || cleanWeekly < 0) {
      showToast('Los importes base no pueden ser negativos', 'error');
      return;
    }

    setState((prev) => {
      const updatedIncomes = prev.incomes.map((inc) => {
        if (syncPlannedThursdays && inc.status === 'previsto' && inc.frequency === 'semanal') {
          return { ...inc, amount: cleanWeekly };
        }
        return inc;
      });

      const newLedger: LedgerRecord = {
        id: 'led-' + Date.now(),
        date: prev.settings.currentSystemDate,
        type: 'ajuste',
        description: `Actualización de ingresos base: Mensual ${formatDOP(cleanMonthly)} | Jueves ${formatDOP(cleanWeekly)}`,
        amount: roundDOP(cleanMonthly + cleanWeekly * 4),
        weekId: getWeekIdForDate(prev.settings.currentSystemDate),
        notes: syncPlannedThursdays
          ? 'Se actualizaron los próximos jueves previstos sin alterar el historial recibido.'
          : 'Solo se actualizó la referencia teórica mensual.',
      };

      return {
        ...prev,
        settings: {
          ...prev.settings,
          monthlyIncome: cleanMonthly,
          weeklyIncome: cleanWeekly,
        },
        incomes: updatedIncomes,
        ledger: [newLedger, ...prev.ledger],
      };
    });

    showToast('Ingresos base y proyección mensual actualizados sin perder tu estructura', 'success');
  };

  // Nivel 2: Modificar un ingreso específico (ya recibido o previsto) manteniendo toda la estructura
  const handleEditSingleIncome = (incomeId: string, newAmount: number, newDate: string, newSource: string) => {
    const cleanNewAmount = roundDOP(newAmount);
    if (cleanNewAmount <= 0 || isNaN(cleanNewAmount)) {
      showToast('El nuevo importe debe ser mayor que RD$0', 'error');
      return;
    }

    const existing = state.incomes.find((i) => i.id === incomeId);
    if (!existing) return;

    const delta = roundDOP(cleanNewAmount - existing.amount);
    const updatedSource = newSource.trim() || existing.source;

    setState((prev) => {
      const updatedIncomes = prev.incomes.map((inc) =>
        inc.id === incomeId
          ? {
              ...inc,
              amount: cleanNewAmount,
              date: newDate || inc.date,
              expectedDate: newDate || inc.expectedDate,
              source: updatedSource,
              weekId: getWeekIdForDate(newDate || inc.date),
            }
          : inc
      );

      const updatedLedger = [...prev.ledger];
      if (delta !== 0) {
        updatedLedger.unshift({
          id: 'led-adj-' + Date.now(),
          date: prev.settings.currentSystemDate,
          type: 'ajuste',
          description: `Ajuste de ingreso (${updatedSource}): de ${formatDOP(existing.amount)} a ${formatDOP(cleanNewAmount)}`,
          amount: Math.abs(delta),
          weekId: getWeekIdForDate(prev.settings.currentSystemDate),
          referenceId: incomeId,
          notes:
            existing.status === 'recibido'
              ? delta > 0
                ? `Aumento de +${formatDOP(delta)} sumado al efectivo disponible`
                : `Reducción de -${formatDOP(Math.abs(delta))} aplicada al saldo real`
              : 'Ajuste en ingreso previsto (no afecta efectivo hasta confirmarse)',
        });
      }

      return {
        ...prev,
        incomes: updatedIncomes,
        ledger: updatedLedger,
      };
    });

    if (existing.status === 'recibido' && delta > 0) {
      showToast(`Ingreso aumentado en +${formatDOP(delta)}. Abriendo asistente de distribución...`, 'success');
      openSurplusAssistant(delta, `Aumento en ${updatedSource}`);
    } else {
      showToast(`Ingreso "${updatedSource}" actualizado a ${formatDOP(cleanNewAmount)}`, 'success');
    }
  };

  // Aplicar la distribución elegida en el Asistente de Reparto de Ingreso Extra
  const handleApplySurplusDistribution = (allocationsMap: Record<string, number>) => {
    const entries = Object.entries(allocationsMap).filter(([, amt]) => roundDOP(amt) > 0);
    const totalToAllocate = roundDOP(entries.reduce((acc, [, amt]) => acc + roundDOP(amt), 0));

    if (totalToAllocate <= 0) {
      setActiveModal(null);
      setSurplusContext(null);
      showToast('El ingreso extra quedó 100% en tu Dinero Disponible sin asignar', 'success');
      return;
    }

    setState((prev) => {
      const updatedEnvelopes = prev.envelopes.map((env) => {
        const addAmt = roundDOP(allocationsMap[env.categoryId] || 0);
        if (addAmt <= 0) return env;
        const nextReserved = roundDOP(env.reservedAmount + addAmt);
        return {
          ...env,
          allocatedAmount: roundDOP(env.allocatedAmount + addAmt),
          reservedAmount: nextReserved,
          remainingAmount: nextReserved,
        };
      });

      const newLedgerEntries: LedgerRecord[] = entries.map(([catId, amt], idx) => {
        const cleanAmt = roundDOP(amt);
        const catName = prev.categories.find((c) => c.id === catId)?.name || 'Sobre';
        return {
          id: `led-surplus-${Date.now()}-${idx}`,
          date: prev.settings.currentSystemDate,
          type: 'reserva',
          description: `Reparto de ingreso extra → Sobre ${catName}`,
          amount: cleanAmt,
          categoryId: catId,
          weekId: getWeekIdForDate(prev.settings.currentSystemDate),
          notes: surplusContext?.sourceTitle || 'Asignación desde asistente de excedente',
        };
      });

      return {
        ...prev,
        envelopes: updatedEnvelopes,
        ledger: [...newLedgerEntries, ...prev.ledger],
      };
    });

    setActiveModal(null);
    setSurplusContext(null);
    showToast(`Se repartieron ${formatDOP(totalToAllocate)} entre tus sobres pendientes`, 'success');
  };

  const handleAddIncome = (source: string, amount: number, date: string, status: IncomeStatus, frequency: 'mensual' | 'semanal' | 'unico', notes?: string, askToDistribute = true) => {
    const cleanAmount = roundDOP(amount);
    if (cleanAmount <= 0) {
      showToast('El importe del ingreso debe ser mayor que RD$0', 'error');
      return;
    }
    const weekId = getWeekIdForDate(date);
    const newInc: Income = {
      id: 'inc-' + Date.now(),
      source: source.trim(),
      amount: cleanAmount,
      date,
      expectedDate: date,
      frequency,
      status,
      weekId,
      notes,
    };

    setState((prev) => {
      const updatedLedger = [...prev.ledger];
      if (status === 'recibido') {
        updatedLedger.unshift({
          id: 'led-' + Date.now(),
          date,
          type: 'ingreso',
          description: `Ingreso recibido: ${source.trim()}`,
          amount: cleanAmount,
          weekId,
          referenceId: newInc.id,
          notes,
        });
      }
      return {
        ...prev,
        incomes: [newInc, ...prev.incomes],
        ledger: updatedLedger,
      };
    });

    if (status === 'recibido' && askToDistribute) {
      showToast(`Ingreso recibido de ${formatDOP(cleanAmount)}. ¿Cómo deseas repartirlo?`, 'success');
      openSurplusAssistant(cleanAmount, source.trim());
    } else {
      showToast(
        status === 'recibido'
          ? `Ingreso recibido de ${formatDOP(cleanAmount)} sumado al saldo real`
          : `Ingreso previsto de ${formatDOP(cleanAmount)} agendado (no suma hasta confirmarse)`,
        'success'
      );
    }
  };

  // Reservar dinero desde el Saldo Libre hacia un Sobre o Liberar de un Sobre hacia Saldo Libre
  const handleModifyReserve = (categoryId: string, deltaAmount: number, description: string) => {
    const cleanDelta = roundDOP(deltaAmount);
    if (cleanDelta === 0) return;

    if (cleanDelta > 0 && cleanDelta > metrics.unallocatedAvailable) {
      showToast(
        `Advertencia: Estás reservando más que el dinero libre sin asignar (${formatDOP(metrics.unallocatedAvailable)})`,
        'warning'
      );
    }

    setState((prev) => {
      const updatedEnvelopes = prev.envelopes.map((env) => {
        if (env.categoryId !== categoryId) return env;
        const newReserved = roundDOP(Math.max(0, env.reservedAmount + cleanDelta));
        const newAllocated = cleanDelta > 0 ? roundDOP(env.allocatedAmount + cleanDelta) : env.allocatedAmount;
        return {
          ...env,
          allocatedAmount: newAllocated,
          reservedAmount: newReserved,
          remainingAmount: newReserved,
        };
      });

      const weekId = getWeekIdForDate(prev.settings.currentSystemDate);
      const newLedger: LedgerRecord = {
        id: 'led-' + Date.now(),
        date: prev.settings.currentSystemDate,
        type: cleanDelta > 0 ? 'reserva' : 'liberacion',
        description: description || (cleanDelta > 0 ? 'Asignación a sobre' : 'Liberación de reserva'),
        amount: Math.abs(cleanDelta),
        categoryId,
        weekId,
      };

      return {
        ...prev,
        envelopes: updatedEnvelopes,
        ledger: [newLedger, ...prev.ledger],
      };
    });

    showToast(
      cleanDelta > 0
        ? `Se reservaron ${formatDOP(cleanDelta)} en ${getCategoryName(categoryId)}`
        : `Se liberaron ${formatDOP(Math.abs(cleanDelta))} de ${getCategoryName(categoryId)} al Saldo Libre`,
      'success'
    );
  };

  // Transferir entre sobres sin alterar el saldo total ni crear ingresos falsos
  const handleTransferBetweenEnvelopes = (fromCatId: string, toCatId: string, amount: number, notes: string) => {
    const cleanAmount = roundDOP(amount);
    if (cleanAmount <= 0 || fromCatId === toCatId) {
      showToast('Selecciona sobres distintos y un monto mayor a RD$0', 'error');
      return;
    }

    const sourceEnv = state.envelopes.find((e) => e.categoryId === fromCatId);
    if (sourceEnv && sourceEnv.reservedAmount < cleanAmount) {
      showToast(`El sobre origen solo tiene ${formatDOP(sourceEnv.reservedAmount)} disponibles`, 'error');
      return;
    }

    setState((prev) => {
      const updatedEnvelopes = prev.envelopes.map((env) => {
        if (env.categoryId === fromCatId) {
          const nextRes = roundDOP(Math.max(0, env.reservedAmount - cleanAmount));
          return { ...env, reservedAmount: nextRes, remainingAmount: nextRes };
        }
        if (env.categoryId === toCatId) {
          const nextRes = roundDOP(env.reservedAmount + cleanAmount);
          return {
            ...env,
            allocatedAmount: roundDOP(env.allocatedAmount + cleanAmount),
            reservedAmount: nextRes,
            remainingAmount: nextRes,
          };
        }
        return env;
      });

      const transfer: Transfer = {
        id: 'trf-' + Date.now(),
        sourceEnvelopeId: fromCatId,
        destinationEnvelopeId: toCatId,
        amount: cleanAmount,
        date: prev.settings.currentSystemDate,
        notes: notes || `Transferencia de ${getCategoryName(fromCatId)} a ${getCategoryName(toCatId)}`,
      };

      const newLedger: LedgerRecord = {
        id: 'led-' + Date.now(),
        date: prev.settings.currentSystemDate,
        type: 'transferencia',
        description: `Transferencia: ${getCategoryName(fromCatId)} → ${getCategoryName(toCatId)}`,
        amount: cleanAmount,
        categoryId: toCatId,
        weekId: getWeekIdForDate(prev.settings.currentSystemDate),
        referenceId: transfer.id,
        notes,
      };

      return {
        ...prev,
        envelopes: updatedEnvelopes,
        transfers: [transfer, ...prev.transfers],
        ledger: [newLedger, ...prev.ledger],
      };
    });

    showToast(`Transferencia de ${formatDOP(cleanAmount)} completada sin alterar el saldo total`, 'success');
  };

  // Eliminar un gasto del historial y recalcular todo automáticamente
  const handleDeleteExpense = (expenseId: string) => {
    setState((prev) => {
      const target = prev.expenses.find((e) => e.id === expenseId);
      if (!target) return prev;

      const updatedEnvelopes = prev.envelopes.map((env) => {
        if (env.categoryId !== target.categoryId) return env;
        const newSpent = roundDOP(Math.max(0, env.spentAmount - target.amount));
        const newReserved = target.paidFromReserve
          ? roundDOP(env.reservedAmount + target.amount)
          : env.reservedAmount;
        return {
          ...env,
          spentAmount: newSpent,
          reservedAmount: newReserved,
          remainingAmount: newReserved,
        };
      });

      const updatedBills = prev.bills.map((b) =>
        b.id === target.billId ? { ...b, status: 'reservado' as BillStatus, paymentDate: undefined } : b
      );

      return {
        ...prev,
        expenses: prev.expenses.filter((e) => e.id !== expenseId),
        envelopes: updatedEnvelopes,
        bills: updatedBills,
        fuelLogs: prev.fuelLogs.filter((f) => f.expenseId !== expenseId),
        ledger: prev.ledger.filter((l) => l.referenceId !== expenseId),
      };
    });
    showToast('Movimiento eliminado y saldos actualizados', 'success');
  };

  // ==========================================
  // 7. SISTEMA DE ALERTAS INTELIGENTES REALES
  // ==========================================

  const smartAlerts = useMemo(() => {
    const alerts: { id: string; level: 'danger' | 'warning' | 'info'; title: string; detail: string; actionTab?: string }[] = [];

    // 1. Facturas pendientes que están reservadas pero aún no pagadas
    const unpaidBills = state.bills.filter((b) => b.status === 'reservado' || b.status === 'pendiente');
    if (unpaidBills.length > 0) {
      const totalUnpaid = unpaidBills.reduce((s, b) => s + b.amount, 0);
      alerts.push({
        id: 'al-bills',
        level: 'warning',
        title: `${unpaidBills.length} factura(s) reservadas pendientes de pago (${formatDOP(totalUnpaid)})`,
        detail: `Electricidad, Agua o Internet tienen el dinero apartado, pero debes registrar el pago cuando lo realices.`,
        actionTab: 'facturas',
      });
    }

    // 2. Categorías que exceden o se acercan al presupuesto
    state.categories.forEach((cat) => {
      const env = state.envelopes.find((e) => e.categoryId === cat.id);
      const spent = env ? env.spentAmount : 0;
      if (cat.monthlyLimit > 0) {
        const pct = (spent / cat.monthlyLimit) * 100;
        if (pct >= 100) {
          alerts.push({
            id: `al-over-${cat.id}`,
            level: 'danger',
            title: `Presupuesto excedido en ${cat.name}`,
            detail: `Has gastado ${formatDOP(spent)} de un límite mensual de ${formatDOP(cat.monthlyLimit)} (${pct.toFixed(0)}%).`,
            actionTab: 'presupuesto',
          });
        } else if (pct >= 80) {
          alerts.push({
            id: `al-near-${cat.id}`,
            level: 'warning',
            title: `Presupuesto de ${cat.name} próximo a agotarse (${pct.toFixed(0)}%)`,
            detail: `Quedan ${formatDOP(cat.monthlyLimit - spent)} del límite mensual.`,
            actionTab: 'presupuesto',
          });
        }
      }
    });

    // 3. Alimentación: dinero pendiente de asignar en el mes
    const foodEnv = state.envelopes.find((e) => e.categoryId === 'cat-food');
    if (foodEnv && foodEnv.allocatedAmount < 10000) {
      const pendingFood = 10000 - foodEnv.allocatedAmount;
      alerts.push({
        id: 'al-food-pending',
        level: 'info',
        title: `Alimentación: ${formatDOP( foodEnv.reservedAmount )} disponibles en sobre actual`,
        detail: `Primera asignación de RD$5,500 activa. Quedan ${formatDOP(pendingFood)} pendientes de asignar con los próximos jueves.`,
        actionTab: 'alimentacion',
      });
    }

    // 4. Saldo libre para llegar al jueves
    if (metrics.unallocatedAvailable < 0) {
      alerts.push({
        id: 'al-deficit',
        level: 'danger',
        title: `Déficit en Saldo Libre (${formatDOP(metrics.unallocatedAvailable)})`,
        detail: `Los gastos no cubiertos por reservas han superado el dinero libre de la semana. Revisa tus sobres o gastos foráneos.`,
        actionTab: 'semanal',
      });
    } else if (metrics.unallocatedAvailable < 500) {
      alerts.push({
        id: 'al-low-Thursday',
        level: 'warning',
        title: `Saldo libre ajustado para llegar al jueves (${formatDOP(metrics.unallocatedAvailable)})`,
        detail: `Evita gastos cotidianos no presupuestados antes del próximo aporte de RD$3,500.`,
        actionTab: 'semanal',
      });
    }

    // 5. Gastos foráneos detectados
    const foreignEnv = state.envelopes.find((e) => e.categoryId === 'cat-foreign');
    if (foreignEnv && foreignEnv.spentAmount > 0) {
      alerts.push({
        id: 'al-foreign',
        level: 'warning',
        title: `Fuga hormiga detectada: ${formatDOP(foreignEnv.spentAmount)} en Gastos Foráneos`,
        detail: `Existen gastos cotidianos fuera del presupuesto que reducen tu saldo disponible para la semana.`,
        actionTab: 'cotidianos',
      });
    }

    // 6. Ingresos previstos pendientes de confirmar
    if (metrics.totalScheduledIncome > 0) {
      alerts.push({
        id: 'al-scheduled-inc',
        level: 'info',
        title: `Ingresos previstos no contabilizados: ${formatDOP(metrics.totalScheduledIncome)}`,
        detail: `Recuerda: los próximos aportes de los jueves no se suman al efectivo disponible hasta que los confirmes como recibidos.`,
        actionTab: 'semanal',
      });
    }

    return alerts;
  }, [state, metrics]);

  // ==========================================
  // 8. NAVEGACIÓN PRINCIPAL
  // ==========================================

  const navItems = [
    { id: 'resumen', label: '1. Resumen general', shortLabel: 'Resumen', icon: LayoutDashboard },
    { id: 'midinero', label: '2. Mi dinero (Sobres)', shortLabel: 'Mi dinero', icon: Wallet },
    { id: 'presupuesto', label: '3. Presupuesto mensual', shortLabel: 'Presupuesto', icon: PieChart },
    { id: 'semanal', label: '4. Control semanal', shortLabel: 'Semanal', icon: Calendar },
    { id: 'alimentacion', label: '5. Alimentación', shortLabel: 'Comida', icon: Utensils },
    { id: 'combustible', label: '6. Combustible', shortLabel: 'Gasolina', icon: Fuel },
    { id: 'facturas', label: '7. Facturas y pagos', shortLabel: 'Facturas', icon: Receipt },
    { id: 'cotidianos', label: '8. Gastos cotidianos', shortLabel: 'Foráneos', icon: ShoppingBag },
    { id: 'historial', label: '9. Historial', shortLabel: 'Historial', icon: History },
    { id: 'informes', label: '10. Informes', shortLabel: 'Informes', icon: BarChart3 },
    { id: 'configuracion', label: '11. Configuración', shortLabel: 'Ajustes', icon: SettingsIcon },
  ];

  // ==========================================
  // 9. VISTAS DE CADA SECCIÓN
  // ==========================================

  // --- SECCIÓN 1: RESUMEN GENERAL ---
  const renderResumenGeneral = () => {
    const budgetProgressPct = Math.min(100, (metrics.totalSpent / metrics.totalMonthlyBudget) * 100);

    return (
      <div className="space-y-6">
        {/* Barra de Acciones Rápidas */}
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs uppercase tracking-wider text-[#A78BFA] font-semibold">
                Centro de Acciones Rápidas • Hogar de {state.settings.householdSize} personas
              </span>
              <h2 className="text-sm text-[#9292A3]">
                Registra cualquier movimiento en segundos y actualiza tus sobres al instante
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveModal('comida')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#A78BFA]/15 hover:bg-[#A78BFA]/25 text-[#C4B5FD] border border-[#A78BFA]/30 text-xs font-medium transition"
              >
                <Utensils className="w-3.5 h-3.5" /> + Compra Comida
              </button>
              <button
                onClick={() => setActiveModal('gasolina')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6EE7B7]/15 hover:bg-[#6EE7B7]/25 text-[#A7F3D0] border border-[#6EE7B7]/30 text-xs font-medium transition"
              >
                <Fuel className="w-3.5 h-3.5" /> + Gasolina
              </button>
              <button
                onClick={() => setActiveModal('gasto')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F87171]/15 hover:bg-[#F87171]/25 text-[#F87171] border border-[#F87171]/30 text-xs font-medium transition"
              >
                <Plus className="w-3.5 h-3.5" /> + Registrar Gasto
              </button>
              <button
                onClick={() => setActiveModal('ingreso')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] text-xs font-bold transition"
              >
                <DollarSign className="w-3.5 h-3.5" /> + Ingreso
              </button>
              <button
                onClick={() => setActiveModal('modificarIngresos')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#A78BFA]/20 hover:bg-[#A78BFA]/30 text-[#C4B5FD] border border-[#A78BFA]/40 text-xs font-bold transition"
              >
                <Edit3 className="w-3.5 h-3.5" /> Modificar Ingresos
              </button>
              <button
                onClick={() => setActiveTab('facturas')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#101014] hover:bg-[#9292A3]/15 text-[#F8FAFC] border border-[#9292A3]/25 text-xs font-medium transition"
              >
                <Receipt className="w-3.5 h-3.5 text-[#FBBF24]" /> Pagar Factura
              </button>
              <button
                onClick={() => setActiveModal('pruebas')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] text-xs font-bold transition shadow-md"
              >
                <FlaskConical className="w-3.5 h-3.5" /> Verificar 6 Pruebas
              </button>
            </div>
          </div>
        </div>

        {/* 5-Second Clarity KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* 1. Saldo Real / Recibido */}
          <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#9292A3]">1. Saldo en Caja (Real)</span>
              <span className="p-2 rounded-xl bg-[#A78BFA]/15 text-[#A78BFA]">
                <Wallet className="w-4 h-4" />
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-[#F8FAFC]">{formatDOP(metrics.realCashBalance)}</div>
              <div className="text-[11px] text-[#9292A3] mt-0.5">
                Recibido confirm.: <span className="text-[#A7F3D0] font-medium">{formatDOP(metrics.totalReceivedIncome)}</span>
              </div>
            </div>
            <div className="text-[11px] text-[#C4B5FD] bg-[#A78BFA]/10 px-2.5 py-1 rounded-lg">
              Recibido menos gastos pagados
            </div>
          </div>

          {/* 2. Dinero Disponible (Sin asignar + desglose) */}
          <div className="bg-[#191922] border-2 border-[#6EE7B7]/40 rounded-2xl p-4 flex flex-col justify-between shadow-lg shadow-[#6EE7B7]/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#6EE7B7]">2. Dinero Disponible</span>
              <span className="p-2 rounded-xl bg-[#6EE7B7]/15 text-[#6EE7B7]">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-extrabold text-[#6EE7B7]">
                {formatDOP(metrics.unallocatedAvailable)}
              </div>
              <div className="text-[11px] text-[#9292A3] mt-0.5">
                Libre para distribuir o imprevistos
              </div>
            </div>
            <div className="text-[11px] text-[#A7F3D0] bg-[#6EE7B7]/10 px-2.5 py-1 rounded-lg">
              + {formatDOP(metrics.totalReservedInEnvelopes)} activos en sobres
            </div>
          </div>

          {/* 3. Dinero Reservado */}
          <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#9292A3]">3. Dinero Reservado</span>
              <span className="p-2 rounded-xl bg-[#FBBF24]/15 text-[#FBBF24]">
                <Lock className="w-4 h-4" />
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-[#F8FAFC]">{formatDOP(metrics.totalReservedInEnvelopes)}</div>
              <div className="text-[11px] text-[#9292A3] mt-0.5">
                Apartado en sobres y facturas
              </div>
            </div>
            <div className="text-[11px] text-[#FBBF24] bg-[#FBBF24]/10 px-2.5 py-1 rounded-lg">
              Protegido (No es dinero gastado)
            </div>
          </div>

          {/* 4. Dinero Gastado en el Mes */}
          <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#9292A3]">4. Gastado en el Mes</span>
              <span className="p-2 rounded-xl bg-[#F87171]/15 text-[#F87171]">
                <TrendingDown className="w-4 h-4" />
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-[#F8FAFC]">{formatDOP(metrics.totalSpent)}</div>
              <div className="text-[11px] text-[#9292A3] mt-0.5">
                {state.expenses.length} movimiento(s) de gasto
              </div>
            </div>
            <div className="text-[11px] text-[#F87171] bg-[#F87171]/10 px-2.5 py-1 rounded-lg">
              {budgetProgressPct.toFixed(1)}% del presupuesto mensual
            </div>
          </div>

          {/* 5. Próximo Jueves de Pago */}
          <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#9292A3]">5. Próximo Ingreso</span>
              <span className="p-2 rounded-xl bg-[#A78BFA]/15 text-[#A78BFA]">
                <Calendar className="w-4 h-4" />
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-[#C4B5FD]">
                {metrics.nextScheduledIncome ? formatDOP(metrics.nextScheduledIncome.amount) : 'RD$3,500'}
              </div>
              <div className="text-[11px] text-[#9292A3] mt-0.5">
                Jueves {metrics.nextScheduledIncome?.expectedDate || metrics.nextThursday}
              </div>
            </div>
            <div className="text-[11px] text-[#6EE7B7] bg-[#6EE7B7]/10 px-2.5 py-1 rounded-lg flex items-center justify-between">
              <span>Faltan {metrics.daysRemaining} días</span>
              <span className=" uppercase text-[10px] font-bold">Previsto</span>
            </div>
          </div>
        </div>

        {/* Fila Central: ¿Cuánto dinero puedo gastar hoy? + Indicador Presupuesto Mensual */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ¿Cuánto dinero puedo gastar hoy? */}
          <div className="lg:col-span-7 bg-[#191922] border border-[#A78BFA]/30 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#6EE7B7]/15 text-[#6EE7B7]">
                  <Sparkles className="w-3.5 h-3.5" /> Guía de Liquidez Diaria Real
                </span>
                <span className="text-xs text-[#9292A3]">
                  Basado en efectivo real (no teórico)
                </span>
              </div>
              <h3 className="text-xl font-bold text-[#F8FAFC] mb-1">
                ¿Cuánto dinero puedo gastar hoy?
              </h3>
              <p className="text-xs text-[#9292A3] mb-5">
                Cálculo automático para que tu efectivo llegue sin sobresaltos hasta el próximo jueves ({metrics.daysRemaining} días restantes), respetando las facturas ya reservadas.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="bg-[#101014] border border-[#6EE7B7]/25 rounded-xl p-4">
                  <span className="text-xs text-[#9292A3] block">Margen Diario de Saldo Libre</span>
                  <div className="text-2xl font-extrabold text-[#6EE7B7] mt-1">
                    {formatDOP(metrics.safeDailyFreeSpend)} <span className="text-xs font-normal text-[#9292A3]">/ día</span>
                  </div>
                  <p className="text-[11px] text-[#9292A3] mt-1.5">
                    De tus <strong className="text-[#F8FAFC]">{formatDOP(metrics.unallocatedAvailable)}</strong> libres sin asignar para los próximos {metrics.daysRemaining} días.
                  </p>
                </div>

                <div className="bg-[#101014] border border-[#A78BFA]/25 rounded-xl p-4">
                  <span className="text-xs text-[#9292A3] block">Ritmo Diario en Alimentación (Sobre)</span>
                  <div className="text-2xl font-extrabold text-[#C4B5FD] mt-1">
                    {formatDOP(metrics.safeDailyFoodSpend)} <span className="text-xs font-normal text-[#9292A3]">/ día</span>
                  </div>
                  <p className="text-[11px] text-[#9292A3] mt-1.5">
                    De los <strong className="text-[#F8FAFC]">{formatDOP(metrics.foodEnvelope.reservedAmount)}</strong> reservados actualmente en el sobre de comida.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#101014] rounded-xl p-3.5 border border-[#9292A3]/15 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-[#9292A3]">
                <Info className="w-4 h-4 text-[#A78BFA] shrink-0" />
                <span>
                  Combustible disponible hasta el jueves: <strong className="text-[#6EE7B7]">{formatDOP(metrics.fuelEnvelope.reservedAmount)}</strong>
                </span>
              </div>
              <button
                onClick={() => setActiveTab('semanal')}
                className="text-[#A78BFA] hover:text-[#C4B5FD] font-semibold flex items-center gap-1"
              >
                Ver Plan Semanal <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Indicador Visual del Presupuesto Mensual Teórico vs Real */}
          <div className="lg:col-span-5 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#A78BFA]">
                  Equilibrio del Presupuesto Mensual
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#A78BFA]/15 text-[#C4B5FD]">
                  Mes de 4 Jueves
                </span>
              </div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-4">
                Referencia Mensual vs Gastos Presupuestados
              </h3>

              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[#9292A3]">Ingresos de referencia (RD$10k + 4×RD$3.5k)</span>
                    <span className="font-bold text-[#6EE7B7]">{formatDOP(metrics.referenceMonthlyIncome)}</span>
                  </div>
                  <div className="w-full h-2 bg-[#101014] rounded-full overflow-hidden">
                    <div className="h-full bg-[#6EE7B7] w-full rounded-full" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[#9292A3]">Presupuesto total de categorías</span>
                    <span className="font-bold text-[#C4B5FD]">{formatDOP(metrics.totalMonthlyBudget)}</span>
                  </div>
                  <div className="w-full h-2 bg-[#101014] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#A78BFA] rounded-full"
                      style={{ width: `${Math.min(100, (metrics.totalMonthlyBudget / metrics.referenceMonthlyIncome) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-[#9292A3]/15 flex items-center justify-between">
                  <div>
                    <span className="text-[#F8FAFC] font-medium block">Margen Teórico Mensual</span>
                    <span className="text-[11px] text-[#9292A3]">
                      *No confundir con efectivo disponible hoy
                    </span>
                  </div>
                  <span className="text-base font-bold text-[#FBBF24] bg-[#FBBF24]/10 px-3 py-1 rounded-lg border border-[#FBBF24]/30">
                    {formatDOP(metrics.theoreticalMargin)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#9292A3]/15 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#101014] p-2.5 rounded-xl">
                <span className="text-[#9292A3] block text-[11px]">Ya Asignado este mes</span>
                <span className="font-bold text-[#F8FAFC]">{formatDOP(metrics.totalAllocatedSoFar)}</span>
              </div>
              <div className="bg-[#101014] p-2.5 rounded-xl">
                <span className="text-[#9292A3] block text-[11px]">Pendiente de Asignar</span>
                <span className="font-bold text-[#C4B5FD]">{formatDOP(metrics.pendingMonthlyAllocation)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fila Inferior: Distribución por Categorías + Alertas Inteligentes + Últimos Movimientos */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Distribución del presupuesto */}
          <div className="lg:col-span-5 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[#F8FAFC] text-sm flex items-center gap-2">
                <PieChart className="w-4 h-4 text-[#A78BFA]" /> Distribución del Presupuesto ({formatDOP(metrics.totalMonthlyBudget)})
              </h3>
              <button
                onClick={() => setActiveTab('presupuesto')}
                className="text-xs text-[#A78BFA] hover:underline"
              >
                Editar límites
              </button>
            </div>
            <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
              {state.categories.filter(c => c.monthlyLimit > 0 || c.id === 'cat-foreign').map((cat) => {
                const env = state.envelopes.find((e) => e.categoryId === cat.id);
                const spent = env?.spentAmount || 0;
                const reserved = env?.reservedAmount || 0;
                const pctOfTotal = metrics.totalMonthlyBudget > 0 ? ((cat.monthlyLimit / metrics.totalMonthlyBudget) * 100).toFixed(1) : '0';

                return (
                  <div key={cat.id} className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/10">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-[#F8FAFC] flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </span>
                      <span className="text-[#9292A3]">
                        Límite: <strong className="text-[#F8FAFC]">{formatDOP(cat.monthlyLimit)}</strong> ({pctOfTotal}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#9292A3]">
                      <span>Reservado: <strong className="text-[#C4B5FD]">{formatDOP(reserved)}</strong></span>
                      <span>Gastado: <strong className={spent > 0 ? 'text-[#6EE7B7]' : 'text-[#9292A3]'}>{formatDOP(spent)}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Alertas Inteligentes */}
          <div className="lg:col-span-4 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[#F8FAFC] text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#FBBF24]" /> Alertas Inteligentes ({smartAlerts.length})
              </h3>
            </div>
            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {smartAlerts.map((al) => (
                <div
                  key={al.id}
                  className={`p-3.5 rounded-xl border text-xs ${
                    al.level === 'danger'
                      ? 'bg-[#F87171]/10 border-[#F87171]/30 text-[#F8FAFC]'
                      : al.level === 'warning'
                      ? 'bg-[#FBBF24]/10 border-[#FBBF24]/30 text-[#F8FAFC]'
                      : 'bg-[#A78BFA]/10 border-[#A78BFA]/30 text-[#F8FAFC]'
                  }`}
                >
                  <div className="font-semibold flex items-center justify-between gap-2 mb-1">
                    <span className={al.level === 'danger' ? 'text-[#F87171]' : al.level === 'warning' ? 'text-[#FBBF24]' : 'text-[#C4B5FD]'}>
                      {al.title}
                    </span>
                  </div>
                  <p className="text-[#9292A3] text-[11px] leading-relaxed">{al.detail}</p>
                  {al.actionTab && (
                    <button
                      onClick={() => setActiveTab(al.actionTab!)}
                      className="mt-2 text-[11px] font-semibold text-[#A78BFA] hover:text-[#C4B5FD] flex items-center gap-1"
                    >
                      Revisar ahora <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Últimos Movimientos */}
          <div className="lg:col-span-3 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[#F8FAFC] text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-[#6EE7B7]" /> Últimos Movimientos
              </h3>
              <button
                onClick={() => setActiveTab('historial')}
                className="text-xs text-[#A78BFA] hover:underline"
              >
                Ver todo
              </button>
            </div>
            <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
              {state.ledger.slice(0, 7).map((item) => (
                <div key={item.id} className="bg-[#101014] p-2.5 rounded-xl border border-[#9292A3]/10 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-[#F8FAFC] truncate">{item.description}</div>
                    <div className="text-[10px] text-[#9292A3]">
                      {item.date} • <span className="uppercase">{item.type}</span>
                    </div>
                  </div>
                  <div
                    className={`font-bold shrink-0 ${
                      item.type === 'ingreso'
                        ? 'text-[#6EE7B7]'
                        : item.type === 'gasto'
                        ? 'text-[#F87171]'
                        : 'text-[#C4B5FD]'
                    }`}
                  >
                    {item.type === 'ingreso' ? '+' : item.type === 'gasto' ? '-' : ''}
                    {formatDOP(item.amount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 2: MI DINERO (SOBRES DIGITALES) ---
  const renderMiDinero = () => {
    return (
      <div className="space-y-6">
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#F8FAFC]">Sistema de Sobres y Apartados Digitales</h2>
            <p className="text-xs text-[#9292A3]">
              Administra tus reservas sin mezclar el dinero de las facturas o la comida con el efectivo libre. Ninguna transferencia entre sobres se cuenta como ingreso nuevo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveModal('modificarIngresos')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#101014] text-[#C4B5FD] border border-[#A78BFA]/40 font-bold text-xs hover:bg-[#A78BFA]/15 transition"
            >
              <Edit3 className="w-3.5 h-3.5" /> Modificar Ingresos
            </button>
            {metrics.unallocatedAvailable > 0 && (
              <button
                onClick={() => openSurplusAssistant(metrics.unallocatedAvailable, 'Distribución de Saldo Libre Disponible')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6EE7B7]/15 text-[#6EE7B7] border border-[#6EE7B7]/40 font-bold text-xs hover:bg-[#6EE7B7]/25 transition"
              >
                <Sparkles className="w-3.5 h-3.5" /> Sugerir Reparto de Disponible ({formatDOP(metrics.unallocatedAvailable)})
              </button>
            )}
            <button
              onClick={() => setActiveModal('reserva')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6EE7B7] text-[#101014] font-bold text-xs hover:bg-[#A7F3D0] transition"
            >
              <Lock className="w-3.5 h-3.5" /> Asignar / Reservar en Sobre
            </button>
            <button
              onClick={() => setActiveModal('transferencia')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#A78BFA] text-[#101014] font-bold text-xs hover:bg-[#C4B5FD] transition"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transferir entre Sobres
            </button>
          </div>
        </div>

        {/* Resumen superior de Sobres */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-xs text-[#9292A3]">Saldo Real en Caja</span>
            <div className="text-xl font-bold text-[#F8FAFC] mt-1">{formatDOP(metrics.realCashBalance)}</div>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#A78BFA]/30">
            <span className="text-xs text-[#C4B5FD]">Total Guardado en Sobres</span>
            <div className="text-xl font-bold text-[#A78BFA] mt-1">{formatDOP(metrics.totalReservedInEnvelopes)}</div>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#6EE7B7]/30">
            <span className="text-xs text-[#A7F3D0]">Saldo Libre sin Asignar</span>
            <div className="text-xl font-bold text-[#6EE7B7] mt-1">{formatDOP(metrics.unallocatedAvailable)}</div>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-xs text-[#9292A3]">Total Gastado de Sobres/Caja</span>
            <div className="text-xl font-bold text-[#F87171] mt-1">{formatDOP(metrics.totalSpent)}</div>
          </div>
        </div>

        {/* Tarjetas de cada sobre */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {state.categories.map((cat) => {
            const env = state.envelopes.find((e) => e.categoryId === cat.id) || {
              id: 'temp',
              categoryId: cat.id,
              allocatedAmount: 0,
              spentAmount: 0,
              reservedAmount: 0,
              remainingAmount: 0,
            };
            const totalEnvelopeReference = Math.max(cat.monthlyLimit, env.allocatedAmount, 1);
            const pctConsumed = env.allocatedAmount > 0
              ? Math.min(100, (env.spentAmount / env.allocatedAmount) * 100)
              : cat.monthlyLimit > 0
              ? Math.min(100, (env.spentAmount / cat.monthlyLimit) * 100)
              : 0;

            return (
              <div key={cat.id} className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                      <h3 className="font-bold text-[#F8FAFC] text-base">{cat.name}</h3>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#101014] text-[#9292A3] border border-[#9292A3]/20">
                      Meta: {formatDOP(cat.monthlyLimit)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 my-3 text-xs">
                    <div className="bg-[#101014] p-2.5 rounded-xl">
                      <span className="text-[#9292A3] block text-[11px]">Asignado en el mes</span>
                      <span className="font-bold text-[#F8FAFC] text-sm">{formatDOP(env.allocatedAmount)}</span>
                    </div>
                    <div className="bg-[#101014] p-2.5 rounded-xl border border-[#6EE7B7]/20">
                      <span className="text-[#A7F3D0] block text-[11px]">Reserva Activa (Saldo)</span>
                      <span className="font-bold text-[#6EE7B7] text-sm">{formatDOP(env.reservedAmount)}</span>
                    </div>
                    <div className="bg-[#101014] p-2.5 rounded-xl">
                      <span className="text-[#9292A3] block text-[11px]">Dinero Gastado</span>
                      <span className="font-bold text-[#F87171] text-sm">{formatDOP(env.spentAmount)}</span>
                    </div>
                    <div className="bg-[#101014] p-2.5 rounded-xl">
                      <span className="text-[#9292A3] block text-[11px]">Falta por asignar</span>
                      <span className="font-bold text-[#C4B5FD] text-sm">
                        {formatDOP(Math.max(0, cat.monthlyLimit - env.allocatedAmount))}
                      </span>
                    </div>
                  </div>

                  {/* Barra de consumo del sobre */}
                  <div className="mt-2">
                    <div className="flex justify-between text-[11px] text-[#9292A3] mb-1">
                      <span>Porcentaje consumido</span>
                      <span className="text-[#F8FAFC] font-semibold">{pctConsumed.toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-[#101014] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pctConsumed >= 100 ? 'bg-[#F87171]' : pctConsumed >= 80 ? 'bg-[#FBBF24]' : 'bg-[#6EE7B7]'
                        }`}
                        style={{ width: `${Math.min(100, pctConsumed)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#9292A3]/15">
                  <button
                    onClick={() => handleModifyReserve(cat.id, 500, `Asignación rápida a ${cat.name}`)}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-[#A78BFA]/15 hover:bg-[#A78BFA]/25 text-[#C4B5FD] text-xs font-medium transition"
                  >
                    + Reservar RD$500
                  </button>
                  {env.reservedAmount > 0 && (
                    <button
                      onClick={() =>
                        handleModifyReserve(
                          cat.id,
                          -env.reservedAmount,
                          `Liberación total de reserva de ${cat.name}`
                        )
                      }
                      className="py-1.5 px-2.5 rounded-lg bg-[#101014] hover:bg-[#F87171]/20 text-[#9292A3] hover:text-[#F87171] border border-[#9292A3]/20 text-xs transition flex items-center gap-1"
                      title="Liberar reserva hacia Saldo Libre"
                    >
                      <Unlock className="w-3.5 h-3.5" /> Liberar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // --- SECCIÓN 3: PRESUPUESTO MENSUAL ---
  const renderPresupuestoMensual = () => {
    const handleLimitChange = (catId: string, newLimitStr: string) => {
      const val = roundDOP(Number(newLimitStr));
      if (isNaN(val) || val < 0) return;
      setState((prev) => ({
        ...prev,
        categories: prev.categories.map((c) => (c.id === catId ? { ...c, monthlyLimit: val } : c)),
      }));
    };

    const handleAddNewCategory = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const name = String(formData.get('catName') || '').trim();
      const limit = roundDOP(Number(formData.get('catLimit') || 0));
      if (!name) return;
      const newId = 'cat-' + Date.now();
      setState((prev) => ({
        ...prev,
        categories: [
          ...prev.categories,
          { id: newId, name, monthlyLimit: limit, color: '#A78BFA', type: 'variable', active: true },
        ],
        envelopes: [
          ...prev.envelopes,
          { id: 'env-' + Date.now(), categoryId: newId, allocatedAmount: 0, spentAmount: 0, reservedAmount: 0, remainingAmount: 0 },
        ],
      }));
      e.currentTarget.reset();
      showToast(`Categoría y sobre "${name}" creados correctamente`, 'success');
    };

    return (
      <div className="space-y-6">
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#F8FAFC]">Presupuesto Mensual por Categoría (Noviembre 2026)</h2>
            <p className="text-xs text-[#9292A3]">
              Compara los límites mensuales planificados ({formatDOP(metrics.totalMonthlyBudget)}) frente al gasto real y el dinero reservado. Puedes ajustar cualquier límite en vivo.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-[#6EE7B7]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#6EE7B7]" /> Dentro del presupuesto
            </span>
            <span className="flex items-center gap-1.5 text-[#FBBF24]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FBBF24]" /> Próximo al límite (≥80%)
            </span>
            <span className="flex items-center gap-1.5 text-[#F87171]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F87171]" /> Excedido (≥100%)
            </span>
          </div>
        </div>

        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#101014] text-[#9292A3] border-b border-[#9292A3]/15 uppercase text-[11px]">
                  <th className="p-4">Categoría</th>
                  <th className="p-4">Presupuesto Mensual (Editable)</th>
                  <th className="p-4">Asignado / Reservado</th>
                  <th className="p-4">Gastado Real</th>
                  <th className="p-4">Disponible de Categoría</th>
                  <th className="p-4 w-64">Estado del Límite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#9292A3]/10">
                {state.categories.map((cat) => {
                  const env = state.envelopes.find((e) => e.categoryId === cat.id);
                  const spent = env?.spentAmount || 0;
                  const reserved = env?.reservedAmount || 0;
                  const allocated = env?.allocatedAmount || 0;
                  const remainingVsBudget = roundDOP(cat.monthlyLimit - spent);
                  const pct = cat.monthlyLimit > 0 ? (spent / cat.monthlyLimit) * 100 : spent > 0 ? 100 : 0;

                  const barColor =
                    pct >= 100 ? 'bg-[#F87171]' : pct >= 80 ? 'bg-[#FBBF24]' : 'bg-[#6EE7B7]';

                  return (
                    <tr key={cat.id} className="hover:bg-[#101014]/50 transition">
                      <td className="p-4 font-semibold text-[#F8FAFC] flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1 bg-[#101014] border border-[#9292A3]/25 rounded-lg px-2 py-1 w-36">
                          <span className="text-[#9292A3]">RD$</span>
                          <input
                            type="number"
                            value={cat.monthlyLimit}
                            onChange={(e) => handleLimitChange(cat.id, e.target.value)}
                            className="bg-transparent text-[#F8FAFC] font-bold w-full focus:outline-none"
                          />
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="text-[#C4B5FD] font-medium">{formatDOP(reserved)}</span>
                        <span className="block text-[10px] text-[#9292A3]">
                          Asignado mes: {formatDOP(allocated)}
                        </span>
                      </td>
                      <td className="p-4 font-bold text-[#F8FAFC]">{formatDOP(spent)}</td>
                      <td className="p-4">
                        <span className={`font-bold ${remainingVsBudget < 0 ? 'text-[#F87171]' : 'text-[#6EE7B7]'}`}>
                          {formatDOP(remainingVsBudget)}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className={pct >= 100 ? 'text-[#F87171] font-bold' : pct >= 80 ? 'text-[#FBBF24]' : 'text-[#6EE7B7]'}>
                            {pct.toFixed(1)}%
                          </span>
                          <span className="text-[#9292A3]">
                            {pct >= 100 ? 'Excedido' : pct >= 80 ? 'Cerca del límite' : 'Saludable'}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-[#101014] rounded-full overflow-hidden">
                          <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#101014] font-bold text-[#F8FAFC] border-t border-[#9292A3]/20">
                  <td className="p-4">TOTAL MENSUAL</td>
                  <td className="p-4 text-[#A78BFA]">{formatDOP(metrics.totalMonthlyBudget)}</td>
                  <td className="p-4 text-[#C4B5FD]">{formatDOP(metrics.totalReservedInEnvelopes)}</td>
                  <td className="p-4 text-[#F87171]">{formatDOP(metrics.totalSpent)}</td>
                  <td className="p-4 text-[#6EE7B7]">
                    {formatDOP(metrics.totalMonthlyBudget - metrics.totalSpent)}
                  </td>
                  <td className="p-4 text-xs text-[#9292A3]">
                    Margen teórico vs RD$24,000: <strong className="text-[#6EE7B7]">{formatDOP(metrics.theoreticalMargin)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Crear nueva categoría/sobre */}
        <form onSubmit={handleAddNewCategory} className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-[#9292A3] mb-1">Nueva Categoría / Sobre</label>
            <input
              name="catName"
              required
              placeholder="Ej. Farmacia y Salud"
              className="bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#9292A3] mb-1">Presupuesto Mensual (RD$)</label>
            <input
              name="catLimit"
              type="number"
              min="0"
              defaultValue="1000"
              className="bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC]"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold text-xs transition"
          >
            + Crear Categoría y Sobre
          </button>
        </form>
      </div>
    );
  };

  // --- SECCIÓN 4: CONTROL SEMANAL (JUEVES A MIÉRCOLES) ---
  const renderControlSemanal = () => {
    const activeWeek = WEEKLY_PERIODS.find((w) => w.id === selectedWeekId) || WEEKLY_PERIODS[0];
    const weekIncomesReceived = state.incomes
      .filter((i) => i.weekId === activeWeek.id && i.status === 'recibido')
      .reduce((s, i) => s + i.amount, 0);
    const weekIncomesScheduled = state.incomes
      .filter((i) => i.weekId === activeWeek.id && i.status === 'previsto')
      .reduce((s, i) => s + i.amount, 0);

    const weekExpenses = state.expenses.filter((e) => e.weekId === activeWeek.id);
    const weekTotalSpent = roundDOP(weekExpenses.reduce((s, e) => s + e.amount, 0));

    const weekKidsSpent = roundDOP(
      weekExpenses.filter((e) => e.categoryId === 'cat-kids').reduce((s, e) => s + e.amount, 0)
    );
    const weekOtherSpent = roundDOP(
      weekExpenses
        .filter((e) => !['cat-food', 'cat-fuel', 'cat-kids'].includes(e.categoryId))
        .reduce((s, e) => s + e.amount, 0)
    );

    return (
      <div className="space-y-6">
        {/* Selector de Semanas (Jueves a Miércoles) */}
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <span className="text-xs uppercase font-bold tracking-wider text-[#A78BFA]">
                Ciclo Financiero Jueves → Miércoles
              </span>
              <h2 className="text-lg font-bold text-[#F8FAFC]">
                Planificación y Control Semanal
              </h2>
              <p className="text-xs text-[#9292A3]">
                Las semanas inician los jueves porque ese día se recibe el aporte semanal de RD$3,500.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {WEEKLY_PERIODS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedWeekId(w.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition border ${
                    selectedWeekId === w.id
                      ? 'bg-[#A78BFA] text-[#101014] border-[#A78BFA]'
                      : 'bg-[#101014] text-[#9292A3] border-[#9292A3]/20 hover:text-[#F8FAFC]'
                  }`}
                >
                  {w.id}: {w.startDate.slice(5)} al {w.endDate.slice(5)}
                </button>
              ))}
            </div>
          </div>

          {/* Tarjeta destacada: DINERO PARA LLEGAR AL JUEVES */}
          <div className="bg-gradient-to-r from-[#101014] via-[#191922] to-[#101014] border-2 border-[#6EE7B7]/40 rounded-2xl p-5 shadow-lg">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#6EE7B7]/15 text-[#6EE7B7] mb-2">
                  <Clock className="w-3.5 h-3.5" /> TARJETA CLAVE DE SUPERVIVENCIA SEMANAL
                </span>
                <h3 className="text-2xl font-extrabold text-[#F8FAFC]">
                  Dinero para llegar al jueves
                </h3>
                <p className="text-xs text-[#9292A3] mt-1">
                  Próxima fecha de ingreso: <strong className="text-[#C4B5FD]">Jueves {metrics.nextThursday}</strong> ({metrics.daysRemaining} días restantes).
                </p>
              </div>

              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-[#101014] p-4 rounded-xl border border-[#6EE7B7]/30">
                  <span className="text-[11px] text-[#9292A3] block">Saldo Libre Disponible</span>
                  <span className="text-xl font-extrabold text-[#6EE7B7]">
                    {formatDOP(metrics.unallocatedAvailable)}
                  </span>
                  <span className="text-[10px] text-[#A7F3D0] block mt-1">
                    {formatDOP(metrics.safeDailyFreeSpend)} / día hasta el jueves
                  </span>
                </div>

                <div className="bg-[#101014] p-4 rounded-xl border border-[#A78BFA]/30">
                  <span className="text-[11px] text-[#9292A3] block">Alimentación Disponible</span>
                  <span className="text-xl font-extrabold text-[#C4B5FD]">
                    {formatDOP(metrics.foodEnvelope.reservedAmount)}
                  </span>
                  <span className="text-[10px] text-[#9292A3] block mt-1">
                    En sobre activo de comida
                  </span>
                </div>

                <div className="bg-[#101014] p-4 rounded-xl border border-[#FBBF24]/30">
                  <span className="text-[11px] text-[#9292A3] block">Combustible Disponible</span>
                  <span className="text-xl font-extrabold text-[#FBBF24]">
                    {formatDOP(metrics.fuelEnvelope.reservedAmount)}
                  </span>
                  <span className="text-[10px] text-[#9292A3] block mt-1">
                    Previsión próx. jueves: RD$700
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Indicadores de la semana seleccionada */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Semana</span>
            <span className="font-bold text-[#A78BFA] text-sm">{activeWeek.id}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Ingreso Recibido</span>
            <span className="font-bold text-[#6EE7B7] text-sm">{formatDOP(weekIncomesReceived)}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Ingreso Previsto</span>
            <span className="font-bold text-[#FBBF24] text-sm">{formatDOP(weekIncomesScheduled)}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Comida Disp.</span>
            <span className="font-bold text-[#C4B5FD] text-sm">{formatDOP(metrics.foodEnvelope.reservedAmount)}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Gasolina Disp.</span>
            <span className="font-bold text-[#A7F3D0] text-sm">{formatDOP(metrics.fuelEnvelope.reservedAmount)}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Gastos Hijos</span>
            <span className="font-bold text-[#F8FAFC] text-sm">{formatDOP(weekKidsSpent)}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Otros Gastos</span>
            <span className="font-bold text-[#F8FAFC] text-sm">{formatDOP(weekOtherSpent)}</span>
          </div>
          <div className="bg-[#191922] p-3.5 rounded-xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Total Gastado Sem.</span>
            <span className="font-bold text-[#F87171] text-sm">{formatDOP(weekTotalSpent)}</span>
          </div>
        </div>

        {/* Lista de Ingresos de los Jueves (Confirmados vs Previstos) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <h3 className="font-bold text-[#F8FAFC] text-sm mb-3 flex flex-wrap items-center justify-between gap-2">
              <span>Calendario de Ingresos y Aportes de los Jueves</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveModal('modificarIngresos')}
                  className="text-xs px-2.5 py-1 rounded-lg bg-[#A78BFA]/15 text-[#C4B5FD] font-semibold flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" /> Editar Montos
                </button>
                <button
                  onClick={() => setActiveModal('ingreso')}
                  className="text-xs px-2.5 py-1 rounded-lg bg-[#6EE7B7]/15 text-[#6EE7B7] font-semibold"
                >
                  + Añadir Ingreso
                </button>
              </div>
            </h3>
            <div className="space-y-2.5">
              {state.incomes.map((inc) => (
                <div
                  key={inc.id}
                  className="bg-[#101014] p-3.5 rounded-xl border border-[#9292A3]/15 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-bold text-[#F8FAFC] flex items-center gap-2">
                      {inc.source}
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                          inc.status === 'recibido'
                            ? 'bg-[#6EE7B7]/15 text-[#6EE7B7]'
                            : 'bg-[#FBBF24]/15 text-[#FBBF24]'
                        }`}
                      >
                        {inc.status}
                      </span>
                    </div>
                    <div className="text-[#9292A3] text-[11px] mt-0.5">
                      Fecha: {inc.expectedDate} • {inc.weekId}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-[#F8FAFC]">{formatDOP(inc.amount)}</span>
                    <button
                      onClick={() => setActiveModal('modificarIngresos')}
                      className="p-1.5 rounded-lg bg-[#191922] hover:bg-[#A78BFA]/20 text-[#C4B5FD] border border-[#9292A3]/20 transition"
                      title="Modificar importe de este ingreso"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {inc.status === 'previsto' && (
                      <button
                        onClick={() => handleConfirmPlannedIncome(inc.id)}
                        className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold text-xs transition"
                      >
                        Confirmar Recibido
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gastos de la semana seleccionada */}
          <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <h3 className="font-bold text-[#F8FAFC] text-sm mb-3">
              Movimientos Registrados en {activeWeek.label}
            </h3>
            {weekExpenses.length === 0 ? (
              <div className="bg-[#101014] rounded-xl p-8 text-center text-xs text-[#9292A3]">
                No se han registrado gastos en esta semana todavía.
              </div>
            ) : (
              <div className="space-y-2.5">
                {weekExpenses.map((exp) => (
                  <div key={exp.id} className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/15 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-[#F8FAFC]">{exp.description}</div>
                      <div className="text-[11px] text-[#9292A3]">
                        {exp.date} • {getCategoryName(exp.categoryId)} • {exp.paidFromReserve ? 'Cubierto con Reserva' : 'Saldo Libre'}
                      </div>
                    </div>
                    <span className="font-bold text-[#F87171]">-{formatDOP(exp.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 5: CONTROL DE ALIMENTACIÓN ---
  const renderAlimentacion = () => {
    const foodExpenses = state.expenses.filter((e) => e.categoryId === 'cat-food');
    const foodEnv = metrics.foodEnvelope;
    const foodMonthlyLimit = state.categories.find((c) => c.id === 'cat-food')?.monthlyLimit || 10000;
    const pendingToAllocate = Math.max(0, foodMonthlyLimit - foodEnv.allocatedAmount);

    // Promedio diario y proyección
    const uniqueDays = Math.max(1, new Set(foodExpenses.map((e) => e.date)).size);
    const avgDailyFood = foodExpenses.length > 0 ? roundDOP(foodEnv.spentAmount / uniqueDays) : 0;
    const projectedMonthlyFood = roundDOP(avgDailyFood * 30);

    // Agrupación por tipo de comida
    const foodTypes: FoodPurchaseType[] = ['Desayuno', 'Almuerzo', 'Cena', 'Merienda', 'Compra general', 'Otros'];
    const byType = foodTypes.map((t) => ({
      type: t,
      total: roundDOP(
        foodExpenses.filter((e) => (e.foodType || 'Compra general') === t).reduce((s, e) => s + e.amount, 0)
      ),
    }));

    const handleFoodSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const amount = roundDOP(Number(fd.get('amount')));
      const description = String(fd.get('description') || 'Compra de alimentos');
      const merchant = String(fd.get('merchant') || 'Supermercado / Colmado');
      const date = String(fd.get('date') || state.settings.currentSystemDate);
      const foodType = (fd.get('foodType') as FoodPurchaseType) || 'Compra general';
      const notes = String(fd.get('notes') || '');

      const ok = handleAddExpense({
        description: `${description} (${merchant})`,
        amount,
        date,
        categoryId: 'cat-food',
        paymentMethod: 'Efectivo / Débito',
        merchant,
        foodType,
        notes,
        useReserve: true,
      });
      if (ok) e.currentTarget.reset();
    };

    return (
      <div className="space-y-6">
        {/* KPIs de Alimentación */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Presupuesto Mensual</span>
            <span className="text-lg font-bold text-[#F8FAFC]">{formatDOP(foodMonthlyLimit)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#A78BFA]/30">
            <span className="text-[11px] text-[#C4B5FD] block">Asignado a la Fecha</span>
            <span className="text-lg font-bold text-[#A78BFA]">{formatDOP(foodEnv.allocatedAmount)}</span>
            <span className="text-[10px] text-[#9292A3] block">Falta asignar: {formatDOP(pendingToAllocate)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#6EE7B7]/40">
            <span className="text-[11px] text-[#6EE7B7] block">Saldo Restante en Sobre</span>
            <span className="text-lg font-extrabold text-[#6EE7B7]">{formatDOP(foodEnv.reservedAmount)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Total Gastado</span>
            <span className="text-lg font-bold text-[#F87171]">{formatDOP(foodEnv.spentAmount)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Promedio Diario Real</span>
            <span className="text-lg font-bold text-[#F8FAFC]">{formatDOP(avgDailyFood)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Compras Realizadas</span>
            <span className="text-lg font-bold text-[#C4B5FD]">{foodExpenses.length}</span>
            <span className="text-[10px] text-[#9292A3] block">Proy. mes: {formatDOP(projectedMonthlyFood)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Formulario Rápido de Compra de Alimentos */}
          <div className="lg:col-span-5 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <h3 className="font-bold text-[#F8FAFC] text-base mb-1 flex items-center gap-2">
              <Utensils className="w-4 h-4 text-[#A78BFA]" /> Registrar Compra de Alimentos
            </h3>
            <p className="text-xs text-[#9292A3] mb-4">
              Registra compras diarias de colmado, mercado o supermercado. Se descuentan de tu reserva de alimentación ({formatDOP(foodEnv.reservedAmount)}) sin descontar dos veces.
            </p>
            <form onSubmit={handleFoodSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#9292A3] mb-1">Fecha</label>
                  <input
                    type="date"
                    name="date"
                    defaultValue={state.settings.currentSystemDate}
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Importe (RD$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    name="amount"
                    placeholder="Ej. 450"
                    required
                    className="w-full bg-[#101014] border border-[#6EE7B7]/40 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#9292A3] mb-1">Comercio / Supermercado</label>
                  <input
                    type="text"
                    name="merchant"
                    placeholder="Colmado, Sirena, Bravo..."
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Tipo de Compra</label>
                  <select
                    name="foodType"
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  >
                    {foodTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[#9292A3] mb-1">Descripción de productos</label>
                <input
                  type="text"
                  name="description"
                  placeholder="Ej. Arroz, huevos, plátanos, leche..."
                  required
                  className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                />
              </div>

              <div>
                <label className="block text-[#9292A3] mb-1">Observaciones (Opcional)</label>
                <input
                  type="text"
                  name="notes"
                  placeholder="Notas adicionales..."
                  className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold transition shadow-md"
              >
                Guardar Compra de Alimentación
              </button>
            </form>
          </div>

          {/* Desglose y lista de compras de comida */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
              <h3 className="font-bold text-[#F8FAFC] text-sm mb-3">Distribución por Tipo de Comida</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {byType.map((item) => (
                  <div key={item.type} className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/10">
                    <span className="text-xs text-[#9292A3] block">{item.type}</span>
                    <span className="text-sm font-bold text-[#C4B5FD]">{formatDOP(item.total)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
              <h3 className="font-bold text-[#F8FAFC] text-sm mb-3">Historial de Compras de Alimentación</h3>
              {foodExpenses.length === 0 ? (
                <div className="bg-[#101014] rounded-xl p-6 text-center text-xs text-[#9292A3]">
                  Aún no has registrado compras de alimentos. Los RD$5,500 de la primera asignación están intactos.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[280px] overflow-y-auto">
                  {foodExpenses.map((exp) => (
                    <div key={exp.id} className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/15 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-[#F8FAFC]">{exp.description}</div>
                        <div className="text-[11px] text-[#9292A3]">
                          {exp.date} • <span className="text-[#C4B5FD]">{exp.foodType || 'Compra general'}</span>
                        </div>
                      </div>
                      <span className="font-bold text-[#6EE7B7]">{formatDOP(exp.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 6: CONTROL DE COMBUSTIBLE ---
  const renderCombustible = () => {
    const [calcPrice, setCalcPrice] = useState<string>(String(state.settings.fuelPrice));
    const [calcTotal, setCalcTotal] = useState<string>('700');
    const [calcGallons, setCalcGallons] = useState<string>(() =>
      String(roundDOP(700 / state.settings.fuelPrice))
    );

    const handleTotalChange = (val: string) => {
      setCalcTotal(val);
      const numTotal = Number(val);
      const numPrice = Number(calcPrice);
      if (numTotal > 0 && numPrice > 0) {
        setCalcGallons(String(roundDOP(numTotal / numPrice)));
      }
    };

    const handleGallonsChange = (val: string) => {
      setCalcGallons(val);
      const numGal = Number(val);
      const numPrice = Number(calcPrice);
      if (numGal > 0 && numPrice > 0) {
        setCalcTotal(String(roundDOP(numGal * numPrice)));
      }
    };

    const handlePriceChange = (val: string) => {
      setCalcPrice(val);
      const numPrice = Number(val);
      const numTotal = Number(calcTotal);
      if (numPrice > 0 && numTotal > 0) {
        setCalcGallons(String(roundDOP(numTotal / numPrice)));
      }
    };

    const handleFuelSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const date = String(fd.get('date') || state.settings.currentSystemDate);
      const odometer = fd.get('odometer') ? Number(fd.get('odometer')) : undefined;
      const notes = String(fd.get('notes') || '');
      const total = roundDOP(Number(calcTotal));
      const gallons = roundDOP(Number(calcGallons));
      const pricePerGallon = roundDOP(Number(calcPrice));

      if (total <= 0 || gallons <= 0) {
        showToast('Verifica el importe y los galones de combustible', 'error');
        return;
      }

      handleAddExpense({
        description: `Gasolina (${gallons} gal a ${formatDOP(pricePerGallon, true)}/gal)`,
        amount: total,
        date,
        categoryId: 'cat-fuel',
        paymentMethod: 'Efectivo / Tarjeta',
        notes,
        useReserve: true,
        fuelData: { gallons, pricePerGallon, odometer },
      });
    };

    const totalGallonsBought = roundDOP(state.fuelLogs.reduce((s, f) => s + f.gallons, 0));
    const totalFuelSpent = metrics.fuelEnvelope.spentAmount;
    const fuelBudget = state.categories.find((c) => c.id === 'cat-fuel')?.monthlyLimit || 3800;
    const avgPricePerGal =
      state.fuelLogs.length > 0
        ? roundDOP(state.fuelLogs.reduce((s, f) => s + f.pricePerGallon, 0) / state.fuelLogs.length)
        : state.settings.fuelPrice;

    return (
      <div className="space-y-6">
        {/* KPIs de Combustible */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Precio Ref. / Galón</span>
            <span className="text-lg font-bold text-[#A78BFA]">{formatDOP(avgPricePerGal, true)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Presupuesto Mensual</span>
            <span className="text-lg font-bold text-[#F8FAFC]">{formatDOP(fuelBudget)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#6EE7B7]/40">
            <span className="text-[11px] text-[#6EE7B7] block">Reserva Actual (Jueves)</span>
            <span className="text-lg font-extrabold text-[#6EE7B7]">{formatDOP(metrics.fuelEnvelope.reservedAmount)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Gastado en el Mes</span>
            <span className="text-lg font-bold text-[#F87171]">{formatDOP(totalFuelSpent)}</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#9292A3]/15">
            <span className="text-[11px] text-[#9292A3] block">Galones Comprados</span>
            <span className="text-lg font-bold text-[#C4B5FD]">{totalGallonsBought} gal</span>
          </div>
          <div className="bg-[#191922] p-4 rounded-2xl border border-[#FBBF24]/30">
            <span className="text-[11px] text-[#FBBF24] block">Previsión Próx. Jueves</span>
            <span className="text-lg font-bold text-[#FBBF24]">RD$700</span>
            <span className="text-[10px] text-[#9292A3] block">Estimación (No gasto)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <h3 className="font-bold text-[#F8FAFC] text-base mb-1 flex items-center gap-2">
              <Fuel className="w-4 h-4 text-[#6EE7B7]" /> Registrar Recarga de Gasolina
            </h3>
            <p className="text-xs text-[#9292A3] mb-4">
              Calcula automáticamente los galones según el importe pagado (o viceversa) sin imponer compras fijas.
            </p>
            <form onSubmit={handleFuelSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#9292A3] mb-1">Fecha</label>
                  <input
                    type="date"
                    name="date"
                    defaultValue={state.settings.currentSystemDate}
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Precio por Galón (RD$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={calcPrice}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#6EE7B7] font-semibold mb-1">Importe Total (RD$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={calcTotal}
                    onChange={(e) => handleTotalChange(e.target.value)}
                    required
                    className="w-full bg-[#101014] border border-[#6EE7B7]/40 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[#C4B5FD] font-semibold mb-1">Cantidad de Galones</label>
                  <input
                    type="number"
                    step="0.01"
                    value={calcGallons}
                    onChange={(e) => handleGallonsChange(e.target.value)}
                    required
                    className="w-full bg-[#101014] border border-[#A78BFA]/40 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#9292A3] mb-1">Kilometraje (Opcional)</label>
                  <input
                    type="number"
                    name="odometer"
                    placeholder="Ej. 84520"
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Observaciones</label>
                  <input
                    type="text"
                    name="notes"
                    placeholder="Estación Shell / Sunix..."
                    className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold transition"
              >
                Registrar Combustible ({formatDOP(Number(calcTotal))} ≈ {calcGallons} gal)
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <h3 className="font-bold text-[#F8FAFC] text-sm mb-3">Bitácora de Recargas y Previsión</h3>
            <div className="bg-[#101014] border border-[#FBBF24]/30 rounded-xl p-3.5 mb-4 text-xs flex items-center justify-between">
              <div>
                <span className="text-[#FBBF24] font-bold block">Previsión para el próximo jueves (No confirmada como gasto)</span>
                <span className="text-[#9292A3]">
                  Se estima que RD$700 (~{(700 / state.settings.fuelPrice).toFixed(2)} galones) serán suficientes para la segunda semana.
                </span>
              </div>
              <span className="px-2.5 py-1 rounded bg-[#FBBF24]/15 text-[#FBBF24] font-bold">Previsión: RD$700</span>
            </div>

            {state.fuelLogs.length === 0 ? (
              <div className="bg-[#101014] rounded-xl p-6 text-center text-xs text-[#9292A3]">
                No se han registrado compras de gasolina todavía. Reserva actual disponible: RD$1,000.
              </div>
            ) : (
              <div className="space-y-2.5">
                {state.fuelLogs.map((log) => (
                  <div key={log.id} className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/15 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-[#F8FAFC]">
                        {log.gallons} galones a {formatDOP(log.pricePerGallon, true)}/gal
                      </div>
                      <div className="text-[11px] text-[#9292A3]">
                        {log.date} • {log.weekId} {log.odometer ? `• ${log.odometer} km` : ''} {log.notes ? `• ${log.notes}` : ''}
                      </div>
                    </div>
                    <span className="font-bold text-[#6EE7B7]">{formatDOP(log.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 7: FACTURAS Y PAGOS + GAS DE COCINAR ---
  const renderFacturasYPagos = () => {
    const gasEnv = state.envelopes.find((e) => e.categoryId === 'cat-gas');
    const gasExpenses = state.expenses.filter((e) => e.categoryId === 'cat-gas');

    const handlePayBill = (bill: Bill) => {
      if (bill.status === 'pagado') return;
      handleAddExpense({
        description: `Pago de factura: ${bill.name}`,
        amount: bill.amount,
        date: state.settings.currentSystemDate,
        categoryId: bill.categoryId,
        paymentMethod: 'Transferencia / Efectivo',
        notes: 'Pagado utilizando la reserva existente de la factura',
        useReserve: true,
        billId: bill.id,
      });
    };

    const handleGasRefill = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const amount = roundDOP(Number(fd.get('amount') || 850));
      const notes = String(fd.get('notes') || 'Recarga de cilindro de gas');
      handleAddExpense({
        description: `Recarga Gas de cocinar (${notes})`,
        amount,
        date: state.settings.currentSystemDate,
        categoryId: 'cat-gas',
        paymentMethod: 'Efectivo',
        notes,
        useReserve: true,
      });
      e.currentTarget.reset();
    };

    return (
      <div className="space-y-6">
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
          <h2 className="text-lg font-bold text-[#F8FAFC]">Calendario de Obligaciones y Servicios del Hogar</h2>
          <p className="text-xs text-[#9292A3]">
            Electricidad (RD$1,500), Agua (RD$1,000) e Internet (RD$1,590) tienen su dinero reservado desde el 5 de noviembre, pero figuran como pendientes hasta que confirmes el pago. Al pagar, la reserva se convierte en gasto sin descontar tu dinero libre por segunda vez.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {state.bills.map((bill) => {
            const env = state.envelopes.find((e) => e.categoryId === bill.categoryId);
            const isPaid = bill.status === 'pagado';

            return (
              <div
                key={bill.id}
                className={`bg-[#191922] rounded-2xl p-5 border flex flex-col justify-between ${
                  isPaid ? 'border-[#6EE7B7]/40' : 'border-[#FBBF24]/40'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-[#F8FAFC] text-base">{bill.name}</span>
                    <span
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                        isPaid
                          ? 'bg-[#6EE7B7]/15 text-[#6EE7B7]'
                          : 'bg-[#FBBF24]/15 text-[#FBBF24]'
                      }`}
                    >
                      {isPaid ? 'Pagado' : 'Reservado / Pendiente'}
                    </span>
                  </div>

                  <div className="text-2xl font-extrabold text-[#F8FAFC] mb-3">{formatDOP(bill.amount)}</div>

                  <div className="space-y-1.5 text-xs text-[#9292A3] bg-[#101014] p-3 rounded-xl">
                    <div className="flex justify-between">
                      <span>Vencimiento:</span>
                      <strong className="text-[#F8FAFC]">{bill.dueDate}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Reserva en sobre:</span>
                      <strong className="text-[#C4B5FD]">{formatDOP(env?.reservedAmount || 0)}</strong>
                    </div>
                    {bill.paymentDate && (
                      <div className="flex justify-between">
                        <span>Fecha de pago:</span>
                        <strong className="text-[#6EE7B7]">{bill.paymentDate}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#9292A3]/15">
                  {isPaid ? (
                    <div className="w-full py-2 rounded-xl bg-[#6EE7B7]/15 text-[#6EE7B7] text-center text-xs font-bold flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Factura Pagada Correctamente
                    </div>
                  ) : (
                    <button
                      onClick={() => handlePayBill(bill)}
                      className="w-full py-2.5 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold text-xs transition shadow-md"
                    >
                      Pagar {formatDOP(bill.amount)} usando Reserva
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Módulo de Gas de Cocinar (Categoría mensual de RD$850) */}
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-6">
            <span className="text-xs font-bold uppercase text-[#FBBF24]">Categoría Mensual de Servicio</span>
            <h3 className="text-base font-bold text-[#F8FAFC] mt-0.5">
              Control de Gas de Cocinar (Presupuesto: RD$850)
            </h3>
            <p className="text-xs text-[#9292A3] mt-1">
              Gastado este mes: <strong className="text-[#F8FAFC]">{formatDOP(gasEnv?.spentAmount || 0)}</strong> • Restante del presupuesto: <strong className="text-[#6EE7B7]">{formatDOP(850 - (gasEnv?.spentAmount || 0))}</strong>
            </p>
            {gasExpenses.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {gasExpenses.map((g) => (
                  <div key={g.id} className="text-xs bg-[#101014] px-3 py-1.5 rounded-lg flex justify-between">
                    <span className="text-[#9292A3]">{g.date}: {g.description}</span>
                    <strong className="text-[#FBBF24]">{formatDOP(g.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={handleGasRefill} className="lg:col-span-6 flex flex-wrap items-end gap-3 text-xs">
            <div className="flex-1 min-w-[130px]">
              <label className="block text-[#9292A3] mb-1">Importe Recarga (RD$)</label>
              <input
                name="amount"
                type="number"
                defaultValue="850"
                required
                className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[#9292A3] mb-1">Detalle / Envasadora</label>
              <input
                name="notes"
                type="text"
                placeholder="Propagas / Tropigas..."
                className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-[#FBBF24] hover:bg-[#FBBF24]/80 text-[#101014] font-bold transition"
            >
              Registrar Recarga de Gas
            </button>
          </form>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 8: GASTOS COTIDIANOS (GASTOS FORÁNEOS) ---
  const renderGastosCotidianos = () => {
    const foreignExpenses = state.expenses.filter((e) => e.categoryId === 'cat-foreign');
    const totalForeign = roundDOP(foreignExpenses.reduce((s, e) => s + e.amount, 0));

    const handleForeignSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const amount = roundDOP(Number(fd.get('amount')));
      const description = String(fd.get('description') || 'Gasto cotidiano');
      const date = String(fd.get('date') || state.settings.currentSystemDate);
      const categoryId = String(fd.get('categoryId') || 'cat-foreign');
      const notes = String(fd.get('notes') || '');

      const ok = handleAddExpense({
        description,
        amount,
        date,
        categoryId,
        paymentMethod: 'Efectivo',
        notes,
        useReserve: categoryId !== 'cat-foreign',
      });
      if (ok) e.currentTarget.reset();
    };

    const handleReclassifyExpense = (expenseId: string, newCatId: string) => {
      setState((prev) => {
        const target = prev.expenses.find((e) => e.id === expenseId);
        if (!target || target.categoryId === newCatId) return prev;
        const oldCatId = target.categoryId;

        const updatedEnvelopes = prev.envelopes.map((env) => {
          if (env.categoryId === oldCatId) {
            return { ...env, spentAmount: roundDOP(Math.max(0, env.spentAmount - target.amount)) };
          }
          if (env.categoryId === newCatId) {
            return { ...env, spentAmount: roundDOP(env.spentAmount + target.amount) };
          }
          return env;
        });

        return {
          ...prev,
          expenses: prev.expenses.map((e) => (e.id === expenseId ? { ...e, categoryId: newCatId } : e)),
          envelopes: updatedEnvelopes,
        };
      });
      showToast('Categoría del gasto actualizada correctamente', 'success');
    };

    return (
      <div className="space-y-6">
        <div className="bg-[#191922] border border-[#F87171]/30 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase text-[#F87171]">Detector de Fugas de Efectivo</span>
            <h2 className="text-lg font-bold text-[#F8FAFC]">
              Gastos Cotidianos y Foráneos (Fuera de Presupuesto)
            </h2>
            <p className="text-xs text-[#9292A3]">
              Registra mandados, propinas, compras pequeñas o pagos imprevistos. No se clasifican como alimentación a menos que tú lo decidas.
            </p>
          </div>
          <div className="bg-[#101014] px-4 py-3 rounded-xl border border-[#F87171]/40 text-right">
            <span className="text-[11px] text-[#9292A3] block">Total Gastos Foráneos</span>
            <span className="text-2xl font-extrabold text-[#F87171]">{formatDOP(totalForeign)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleForeignSubmit} className="lg:col-span-5 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 space-y-3 text-xs">
            <h3 className="font-bold text-[#F8FAFC] text-sm mb-2">Captura Rápida de Gasto Cotidiano</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[#9292A3] mb-1">Importe (RD$)</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="Ej. 50, 75, 100"
                  required
                  className="w-full bg-[#101014] border border-[#F87171]/40 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                />
              </div>
              <div>
                <label className="block text-[#9292A3] mb-1">Fecha</label>
                <input
                  name="date"
                  type="date"
                  defaultValue={state.settings.currentSystemDate}
                  required
                  className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[#9292A3] mb-1">Descripción del gasto</label>
              <input
                name="description"
                type="text"
                placeholder="Ej. Mandado, motoconcho, botellón de agua, helado..."
                required
                className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
              />
            </div>
            <div>
              <label className="block text-[#9292A3] mb-1">Categoría inicial</label>
              <select
                name="categoryId"
                defaultValue="cat-foreign"
                className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
              >
                <option value="cat-foreign">Gastos foráneos (No presupuestado)</option>
                {state.categories.filter((c) => c.id !== 'cat-foreign').map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[#9292A3] mb-1">Observaciones</label>
              <input
                name="notes"
                type="text"
                placeholder="Opcional..."
                className="w-full bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-[#F87171] hover:bg-[#F87171]/80 text-[#101014] font-bold transition"
            >
              Registrar Gasto Cotidiano
            </button>
          </form>

          <div className="lg:col-span-7 bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
            <h3 className="font-bold text-[#F8FAFC] text-sm mb-3">
              Listado de Gastos Foráneos (Puedes reclasificar la categoría cuando quieras)
            </h3>
            {foreignExpenses.length === 0 ? (
              <div className="bg-[#101014] rounded-xl p-8 text-center text-xs text-[#9292A3]">
                ¡Excelente! No tienes gastos foráneos registrados hasta el momento.
              </div>
            ) : (
              <div className="space-y-2.5">
                {foreignExpenses.map((exp) => (
                  <div key={exp.id} className="bg-[#101014] p-3.5 rounded-xl border border-[#9292A3]/15 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-bold text-[#F8FAFC]">{exp.description}</div>
                      <div className="text-[11px] text-[#9292A3]">{exp.date} • {exp.weekId}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={exp.categoryId}
                        onChange={(e) => handleReclassifyExpense(exp.id, e.target.value)}
                        className="bg-[#191922] border border-[#9292A3]/30 rounded-lg px-2 py-1 text-[11px] text-[#C4B5FD]"
                      >
                        {state.categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <span className="font-bold text-[#F87171] text-sm">{formatDOP(exp.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 9: HISTORIAL COMPLETO ---
  const [filterType, setFilterType] = useState<string>('todos');
  const [filterCat, setFilterCat] = useState<string>('todas');
  const [filterWeek, setFilterWeek] = useState<string>('todas');

  const renderHistorial = () => {
    const filteredLedger = state.ledger.filter((item) => {
      if (filterType !== 'todos' && item.type !== filterType) return false;
      if (filterCat !== 'todas' && item.categoryId !== filterCat) return false;
      if (filterWeek !== 'todas' && item.weekId !== filterWeek) return false;
      return true;
    });

    return (
      <div className="space-y-6">
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#F8FAFC]">Historial Cronológico y Auditoría de Movimientos</h2>
            <p className="text-xs text-[#9292A3]">
              Consulta ingresos, gastos, reservas, liberaciones y transferencias. Si eliminas un gasto, los saldos se recalculan al instante.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
            >
              <option value="todos">Todos los tipos</option>
              <option value="ingreso">Ingresos</option>
              <option value="gasto">Gastos</option>
              <option value="reserva">Reservas</option>
              <option value="liberacion">Liberaciones</option>
              <option value="transferencia">Transferencias</option>
            </select>

            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
            >
              <option value="todas">Todas las categorías</option>
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              value={filterWeek}
              onChange={(e) => setFilterWeek(e.target.value)}
              className="bg-[#101014] border border-[#9292A3]/25 rounded-xl px-3 py-2 text-[#F8FAFC]"
            >
              <option value="todas">Todas las semanas</option>
              {WEEKLY_PERIODS.map((w) => (
                <option key={w.id} value={w.id}>{w.id}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#101014] text-[#9292A3] border-b border-[#9292A3]/15 uppercase text-[11px]">
                  <th className="p-4">Fecha</th>
                  <th className="p-4">Tipo</th>
                  <th className="p-4">Descripción</th>
                  <th className="p-4">Categoría</th>
                  <th className="p-4">Semana</th>
                  <th className="p-4">Importe</th>
                  <th className="p-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#9292A3]/10">
                {filteredLedger.map((item) => (
                  <tr key={item.id} className="hover:bg-[#101014]/50">
                    <td className="p-4 text-[#9292A3]">{item.date}</td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          item.type === 'ingreso'
                            ? 'bg-[#6EE7B7]/15 text-[#6EE7B7]'
                            : item.type === 'gasto'
                            ? 'bg-[#F87171]/15 text-[#F87171]'
                            : 'bg-[#A78BFA]/15 text-[#C4B5FD]'
                        }`}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td className="p-4 font-medium text-[#F8FAFC]">
                      {item.description}
                      {item.notes && <span className="block text-[10px] text-[#9292A3]">{item.notes}</span>}
                    </td>
                    <td className="p-4 text-[#C4B5FD]">{getCategoryName(item.categoryId)}</td>
                    <td className="p-4 text-[#9292A3]">{item.weekId}</td>
                    <td
                      className={`p-4 font-bold ${
                        item.type === 'ingreso'
                          ? 'text-[#6EE7B7]'
                          : item.type === 'gasto'
                          ? 'text-[#F87171]'
                          : 'text-[#F8FAFC]'
                      }`}
                    >
                      {item.type === 'ingreso' ? '+' : item.type === 'gasto' ? '-' : ''}
                      {formatDOP(item.amount)}
                    </td>
                    <td className="p-4 text-right">
                      {item.type === 'gasto' && item.referenceId && (
                        <button
                          onClick={() => handleDeleteExpense(item.referenceId!)}
                          className="p-1.5 rounded-lg bg-[#F87171]/10 hover:bg-[#F87171]/25 text-[#F87171] transition"
                          title="Eliminar gasto y restaurar saldo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 10: INFORMES Y DIAGNÓSTICO "¿POR QUÉ NO ME ALCANZA EL DINERO?" ---
  const renderInformes = () => {
    const overBudgetCats = state.categories.filter((c) => {
      const env = state.envelopes.find((e) => e.categoryId === c.id);
      return c.monthlyLimit > 0 && (env?.spentAmount || 0) > c.monthlyLimit;
    });

    const smallFrequentExpenses = state.expenses.filter((e) => e.amount <= 300);
    const smallExpensesTotal = roundDOP(smallFrequentExpenses.reduce((s, e) => s + e.amount, 0));

    const foreignExpenses = state.expenses.filter((e) => e.categoryId === 'cat-foreign');
    const foreignTotal = roundDOP(foreignExpenses.reduce((s, e) => s + e.amount, 0));

    return (
      <div className="space-y-6">
        {/* Diagnóstico Basado en Datos Reales: ¿Por qué no me alcanza el dinero? */}
        <div className="bg-[#191922] border-2 border-[#A78BFA]/40 rounded-2xl p-6 shadow-lg">
          <div className="flex items-center gap-2 text-[#A78BFA] text-xs font-bold uppercase tracking-wider mb-1">
            <HelpCircle className="w-4 h-4" /> Diagnóstico Financiero Basado Estrictamente en tus Registros
          </div>
          <h2 className="text-xl font-extrabold text-[#F8FAFC] mb-2">
            Informe Especial: ¿Por qué no me alcanza el dinero?
          </h2>
          <p className="text-xs text-[#9292A3] mb-5">
            Este analizador no inventa causas: evalúa únicamente los movimientos registrados para detectar fugas de efectivo, desbalances de calendario y categorías excedidas.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Causa 1: Categorías excedidas */}
            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <span className="text-xs font-bold text-[#C4B5FD] block mb-1">1. Categorías Excedidas</span>
              {overBudgetCats.length === 0 ? (
                <p className="text-xs text-[#6EE7B7]">
                  Ninguna categoría con presupuesto fijo ha superado su límite mensual todavía.
                </p>
              ) : (
                <ul className="text-xs text-[#F87171] space-y-1">
                  {overBudgetCats.map((c) => {
                    const env = state.envelopes.find((e) => e.categoryId === c.id);
                    return (
                      <li key={c.id}>
                        • {c.name}: +{formatDOP((env?.spentAmount || 0) - c.monthlyLimit)} sobre el límite.
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Causa 2: Gastos pequeños frecuentes */}
            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <span className="text-xs font-bold text-[#C4B5FD] block mb-1">2. Gastos Pequeños Frecuentes (≤RD$300)</span>
              {smallFrequentExpenses.length === 0 ? (
                <p className="text-xs text-[#9292A3]">
                  No hay compras pequeñas registradas aún (0 movimientos menores a RD$300).
                </p>
              ) : (
                <p className="text-xs text-[#FBBF24]">
                  Has realizado <strong>{smallFrequentExpenses.length}</strong> gasto(s) pequeños que suman <strong className="text-[#F8FAFC]">{formatDOP(smallExpensesTotal)}</strong>.
                </p>
              )}
            </div>

            {/* Causa 3: Gastos Foráneos / Cotidianos */}
            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <span className="text-xs font-bold text-[#C4B5FD] block mb-1">3. Gastos Foráneos No Presupuestados</span>
              {foreignExpenses.length === 0 ? (
                <p className="text-xs text-[#6EE7B7]">
                  RD$0 en gastos foráneos. Todo el efectivo sigue dentro del presupuesto planificado.
                </p>
              ) : (
                <p className="text-xs text-[#F87171]">
                  Se han ido <strong>{formatDOP(foreignTotal)}</strong> en {foreignExpenses.length} gasto(s) cotidianos fuera del presupuesto mensual, reduciendo directamente tu margen teórico de RD$1,260.
                </p>
              )}
            </div>

            {/* Causa 4: Desfase de Liquidez Semanal */}
            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <span className="text-xs font-bold text-[#C4B5FD] block mb-1">4. Liquidez Real vs Presupuesto Teórico</span>
              <p className="text-xs text-[#9292A3]">
                Aunque el mes tiene RD$24,000 previstos, hoy solo has recibido <strong className="text-[#6EE7B7]">{formatDOP(metrics.totalReceivedIncome)}</strong> y tienes <strong className="text-[#C4B5FD]">{formatDOP(metrics.totalReservedInEnvelopes)}</strong> reservados. Tu efectivo libre real es <strong className="text-[#F8FAFC]">{formatDOP(metrics.unallocatedAvailable)}</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Comparativa Presupuesto vs Gasto Real por Categoría */}
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-5">
          <h3 className="font-bold text-[#F8FAFC] text-base mb-4">
            Comparativa Gráfica: Presupuesto Mensual vs Reservado vs Gasto Real
          </h3>
          <div className="space-y-3">
            {state.categories.map((cat) => {
              const env = state.envelopes.find((e) => e.categoryId === cat.id);
              const spent = env?.spentAmount || 0;
              const reserved = env?.reservedAmount || 0;
              const maxBar = Math.max(cat.monthlyLimit, spent + reserved, 1000);

              return (
                <div key={cat.id} className="bg-[#101014] p-3.5 rounded-xl border border-[#9292A3]/10 text-xs">
                  <div className="flex flex-wrap justify-between mb-1.5">
                    <span className="font-bold text-[#F8FAFC]">{cat.name}</span>
                    <div className="flex gap-4">
                      <span className="text-[#9292A3]">Presupuesto: <strong className="text-[#F8FAFC]">{formatDOP(cat.monthlyLimit)}</strong></span>
                      <span className="text-[#C4B5FD]">Reservado: <strong>{formatDOP(reserved)}</strong></span>
                      <span className="text-[#6EE7B7]">Gastado: <strong>{formatDOP(spent)}</strong></span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-[#191922] rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-[#6EE7B7]"
                      style={{ width: `${Math.min(100, (spent / maxBar) * 100)}%` }}
                      title={`Gastado: ${formatDOP(spent)}`}
                    />
                    <div
                      className="h-full bg-[#A78BFA]/60"
                      style={{ width: `${Math.min(100, (reserved / maxBar) * 100)}%` }}
                      title={`Reservado: ${formatDOP(reserved)}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // --- SECCIÓN 11: CONFIGURACIÓN, EXPORTACIÓN CSV/JSON Y PERSISTENCIA ---
  const renderConfiguracion = () => {
    const handleExportCSV = () => {
      const headers = ['ID', 'Fecha', 'Tipo', 'Descripcion', 'Categoria', 'Semana', 'Importe_DOP', 'Notas'];
      const rows = state.ledger.map((l) => [
        l.id,
        l.date,
        l.type,
        `"${(l.description || '').replace(/"/g, '""')}"`,
        `"${getCategoryName(l.categoryId)}"`,
        l.weekId,
        l.amount,
        `"${(l.notes || '').replace(/"/g, '""')}"`,
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `mi_balance_movimientos_${state.settings.currentSystemDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Archivo CSV exportado correctamente', 'success');
    };

    const handleExportJSON = () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
      const link = document.createElement('a');
      link.setAttribute('href', dataStr);
      link.setAttribute('download', `mi_balance_respaldo_${state.settings.currentSystemDate}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Respaldo JSON descargado correctamente', 'success');
    };

    const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(String(ev.target?.result));
          if (parsed && parsed.settings && parsed.categories) {
            setState(parsed);
            showToast('Respaldo JSON restaurado con éxito', 'success');
          } else {
            showToast('El archivo JSON no tiene el formato de MI BALANCE', 'error');
          }
        } catch {
          showToast('Error al leer el archivo JSON', 'error');
        }
      };
      reader.readAsText(file);
    };

    return (
      <div className="space-y-6">
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-lg font-bold text-[#F8FAFC] mb-1">Configuración General del Hogar</h2>
              <p className="text-xs text-[#9292A3]">
                Ajusta los parámetros base de tu hogar, modifica ingresos sin perder la estructura o exporta tus movimientos.
              </p>
            </div>
            <button
              onClick={() => setActiveModal('modificarIngresos')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold text-xs transition shadow-md"
            >
              <Edit3 className="w-4 h-4" /> Modificar Ingresos y Reparto
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <label className="block text-[#9292A3] mb-1">Fecha Actual del Sistema</label>
              <input
                type="date"
                value={state.settings.currentSystemDate}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, currentSystemDate: e.target.value },
                  }))
                }
                className="w-full bg-[#191922] border border-[#9292A3]/30 rounded-lg px-3 py-1.5 text-[#F8FAFC] font-bold"
              />
            </div>

            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <label className="block text-[#9292A3] mb-1">Miembros del Hogar</label>
              <input
                type="number"
                min="1"
                value={state.settings.householdSize}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, householdSize: Number(e.target.value) || 5 },
                  }))
                }
                className="w-full bg-[#191922] border border-[#9292A3]/30 rounded-lg px-3 py-1.5 text-[#F8FAFC] font-bold"
              />
            </div>

            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <label className="block text-[#9292A3] mb-1">Precio Gasolina (RD$/gal)</label>
              <input
                type="number"
                step="0.01"
                value={state.settings.fuelPrice}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, fuelPrice: Number(e.target.value) || 317.5 },
                  }))
                }
                className="w-full bg-[#191922] border border-[#9292A3]/30 rounded-lg px-3 py-1.5 text-[#6EE7B7] font-bold"
              />
            </div>

            <div className="bg-[#101014] p-4 rounded-xl border border-[#9292A3]/15">
              <label className="block text-[#9292A3] mb-1">Aporte Semanal Jueves (RD$)</label>
              <input
                type="number"
                step="100"
                value={state.settings.weeklyIncome}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, weeklyIncome: Number(e.target.value) || 3500 },
                  }))
                }
                className="w-full bg-[#191922] border border-[#9292A3]/30 rounded-lg px-3 py-1.5 text-[#A78BFA] font-bold"
              />
            </div>
          </div>
        </div>

        {/* Exportación y Respaldo */}
        <div className="bg-[#191922] border border-[#9292A3]/15 rounded-2xl p-6">
          <h3 className="font-bold text-[#F8FAFC] text-base mb-2">Exportación de Datos y Copias de Seguridad</h3>
          <p className="text-xs text-[#9292A3] mb-4">
            Todos tus datos se guardan automáticamente en el almacenamiento local del navegador (`localStorage`). Además, puedes descargar tu historial en CSV o respaldar la base de datos completa en JSON.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold text-xs transition"
            >
              <FileSpreadsheet className="w-4 h-4" /> Exportar Movimientos a CSV
            </button>
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold text-xs transition"
            >
              <FileJson className="w-4 h-4" /> Descargar Respaldo JSON
            </button>
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#101014] hover:bg-[#9292A3]/20 text-[#F8FAFC] border border-[#9292A3]/30 font-semibold text-xs cursor-pointer transition">
              <Upload className="w-4 h-4 text-[#C4B5FD]" /> Importar Respaldo JSON
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>
            <button
              onClick={() => setActiveModal('confirmReset')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F87171]/15 hover:bg-[#F87171]/25 text-[#F87171] border border-[#F87171]/30 font-semibold text-xs transition"
            >
              <RotateCcw className="w-4 h-4" /> Restaurar Estado Inicial (5 Nov 2026)
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ==========================================
  // 10. MODALES DE OPERACIONES Y VERIFICADOR DE 6 PRUEBAS
  // ==========================================

  const renderModals = () => {
    if (!activeModal) return null;

    return (
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-[#191922] border border-[#9292A3]/25 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
          <button
            onClick={() => setActiveModal(null)}
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-[#101014] text-[#9292A3] hover:text-[#F8FAFC]"
          >
            <X className="w-4 h-4" />
          </button>

          {/* MODAL: GASTO RÁPIDO */}
          {activeModal === 'gasto' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-1">Registrar Gasto Rápido</h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Completa los campos básicos. El sistema actualizará los sobres e indicadores al instante.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const ok = handleAddExpense({
                    description: String(fd.get('description') || 'Gasto'),
                    amount: Number(fd.get('amount')),
                    date: String(fd.get('date') || state.settings.currentSystemDate),
                    categoryId: String(fd.get('categoryId') || 'cat-foreign'),
                    paymentMethod: String(fd.get('paymentMethod') || 'Efectivo'),
                    notes: String(fd.get('notes') || ''),
                  });
                  if (ok) setActiveModal(null);
                }}
                className="space-y-3 text-xs"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Importe (RD$)</label>
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      placeholder="Ej. 250"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Fecha</label>
                    <input
                      name="date"
                      type="date"
                      defaultValue={state.settings.currentSystemDate}
                      required
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Descripción</label>
                  <input
                    name="description"
                    type="text"
                    required
                    placeholder="¿En qué se utilizó el dinero?"
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Categoría</label>
                    <select
                      name="categoryId"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    >
                      {state.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Método de pago</label>
                    <select
                      name="paymentMethod"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Tarjeta de Débito">Tarjeta de Débito</option>
                      <option value="Transferencia">Transferencia</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold transition mt-2"
                >
                  Guardar Gasto
                </button>
              </form>
            </div>
          )}

          {/* MODAL: COMPRA RÁPIDA DE COMIDA */}
          {activeModal === 'comida' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-1">Registrar Compra de Comida</h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Se descontará de tu sobre de Alimentación (Disponible actual: <strong className="text-[#6EE7B7]">{formatDOP(metrics.foodEnvelope.reservedAmount)}</strong>).
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const ok = handleAddExpense({
                    description: `${fd.get('description')} (${fd.get('merchant') || 'Comercio'})`,
                    amount: Number(fd.get('amount')),
                    date: String(fd.get('date') || state.settings.currentSystemDate),
                    categoryId: 'cat-food',
                    paymentMethod: 'Efectivo',
                    merchant: String(fd.get('merchant') || 'Colmado'),
                    foodType: (fd.get('foodType') as FoodPurchaseType) || 'Compra general',
                    useReserve: true,
                  });
                  if (ok) setActiveModal(null);
                }}
                className="space-y-3 text-xs"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Importe (RD$)</label>
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      min="1"
                      defaultValue="450"
                      required
                      className="w-full bg-[#101014] border border-[#6EE7B7]/40 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Tipo</label>
                    <select
                      name="foodType"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    >
                      <option value="Compra general">Compra general</option>
                      <option value="Desayuno">Desayuno</option>
                      <option value="Almuerzo">Almuerzo</option>
                      <option value="Cena">Cena</option>
                      <option value="Merienda">Merienda</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Comercio / Supermercado</label>
                  <input
                    name="merchant"
                    type="text"
                    defaultValue="Colmado / Supermercado"
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Descripción</label>
                  <input
                    name="description"
                    type="text"
                    defaultValue="Compra de alimentos del hogar"
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold transition"
                >
                  Registrar Compra de Alimentos
                </button>
              </form>
            </div>
          )}

          {/* MODAL: GASOLINA RÁPIDA */}
          {activeModal === 'gasolina' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-1">Registrar Gasolina</h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Precio vigente: <strong className="text-[#C4B5FD]">{formatDOP(state.settings.fuelPrice, true)}/gal</strong>. Se calcularán los galones automáticamente.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const total = roundDOP(Number(fd.get('amount') || 700));
                  const price = roundDOP(Number(fd.get('price') || state.settings.fuelPrice));
                  const gallons = roundDOP(total / price);
                  const ok = handleAddExpense({
                    description: `Gasolina (${gallons} gal a ${formatDOP(price, true)}/gal)`,
                    amount: total,
                    date: state.settings.currentSystemDate,
                    categoryId: 'cat-fuel',
                    paymentMethod: 'Efectivo',
                    useReserve: true,
                    fuelData: { gallons, pricePerGallon: price },
                  });
                  if (ok) setActiveModal(null);
                }}
                className="space-y-3 text-xs"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Importe Total (RD$)</label>
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      defaultValue="700"
                      required
                      className="w-full bg-[#101014] border border-[#6EE7B7]/40 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Precio por Galón (RD$)</label>
                    <input
                      name="price"
                      type="number"
                      step="0.01"
                      defaultValue={state.settings.fuelPrice}
                      required
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold transition"
                >
                  Guardar Recarga de Combustible
                </button>
              </form>
            </div>
          )}

          {/* MODAL: REGISTRAR O CONFIRMAR INGRESO */}
          {activeModal === 'ingreso' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-1">Registrar o Confirmar Ingreso</h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Los ingresos previstos no aumentan el efectivo disponible hasta que se marcan como recibidos.
              </p>

              {/* Aportes programados pendientes */}
              {state.incomes.filter((i) => i.status === 'previsto').length > 0 && (
                <div className="mb-4 bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 space-y-2">
                  <span className="text-[11px] font-bold text-[#C4B5FD] block">
                    Confirmar próximo aporte programado del jueves:
                  </span>
                  {state.incomes
                    .filter((i) => i.status === 'previsto')
                    .slice(0, 2)
                    .map((inc) => (
                      <div key={inc.id} className="flex items-center justify-between text-xs">
                        <span>{inc.source} ({inc.expectedDate})</span>
                        <button
                          onClick={() => {
                            handleConfirmPlannedIncome(inc.id);
                            setActiveModal(null);
                          }}
                          className="px-3 py-1 rounded-lg bg-[#6EE7B7] text-[#101014] font-bold"
                        >
                          Recibir {formatDOP(inc.amount)}
                        </button>
                      </div>
                    ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  handleAddIncome(
                    String(fd.get('source') || 'Ingreso adicional'),
                    Number(fd.get('amount')),
                    String(fd.get('date') || state.settings.currentSystemDate),
                    (fd.get('status') as IncomeStatus) || 'recibido',
                    (fd.get('frequency') as 'mensual' | 'semanal' | 'unico') || 'semanal'
                  );
                  setActiveModal(null);
                }}
                className="space-y-3 text-xs"
              >
                <div>
                  <label className="block text-[#9292A3] mb-1">Concepto / Fuente</label>
                  <input
                    name="source"
                    type="text"
                    placeholder="Ej. Aporte 5to jueves / Ingreso extra"
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Importe (RD$)</label>
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      defaultValue="3500"
                      required
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Estado</label>
                    <select
                      name="status"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    >
                      <option value="recibido">Confirmado / Recibido hoy</option>
                      <option value="previsto">Previsto / Programado</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold transition"
                >
                  Guardar Ingreso
                </button>
              </form>
            </div>
          )}

          {/* MODAL: RESERVAR EN SOBRE */}
          {activeModal === 'reserva' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-1">Asignar o Modificar Reserva en Sobre</h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Dinero Libre sin asignar disponible: <strong className="text-[#6EE7B7]">{formatDOP(metrics.unallocatedAvailable)}</strong>
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  handleModifyReserve(
                    String(fd.get('categoryId')),
                    Number(fd.get('amount')),
                    String(fd.get('description') || 'Asignación a sobre')
                  );
                  setActiveModal(null);
                }}
                className="space-y-3 text-xs"
              >
                <div>
                  <label className="block text-[#9292A3] mb-1">Sobre / Categoría</label>
                  <select
                    name="categoryId"
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  >
                    {state.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Importe a reservar (RD$)</label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="1"
                    defaultValue="1000"
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Nota</label>
                  <input
                    name="description"
                    type="text"
                    placeholder="Ej. Segunda asignación para comida"
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold transition"
                >
                  Confirmar Reserva
                </button>
              </form>
            </div>
          )}

          {/* MODAL: TRANSFERIR ENTRE SOBRES */}
          {activeModal === 'transferencia' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-1">Transferir Dinero entre Sobres</h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Mueve fondos reservados de una categoría a otra. Esta operación queda registrada y nunca suma como ingreso nuevo.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  handleTransferBetweenEnvelopes(
                    String(fd.get('fromCat')),
                    String(fd.get('toCat')),
                    Number(fd.get('amount')),
                    String(fd.get('notes') || '')
                  );
                  setActiveModal(null);
                }}
                className="space-y-3 text-xs"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Desde Sobre (Origen)</label>
                    <select
                      name="fromCat"
                      defaultValue="cat-food"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    >
                      {state.categories.map((c) => {
                        const env = state.envelopes.find((e) => e.categoryId === c.id);
                        return (
                          <option key={c.id} value={c.id}>
                            {c.name} ({formatDOP(env?.reservedAmount || 0)})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Hacia Sobre (Destino)</label>
                    <select
                      name="toCat"
                      defaultValue="cat-kids"
                      className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                    >
                      {state.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Monto a transferir (RD$)</label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="1"
                    defaultValue="500"
                    required
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[#9292A3] mb-1">Motivo</label>
                  <input
                    name="notes"
                    type="text"
                    placeholder="Ej. Ajuste semanal"
                    className="w-full bg-[#101014] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC]"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold transition"
                >
                  Realizar Transferencia
                </button>
              </form>
            </div>
          )}

          {/* MODAL: CONFIRMAR RESTAURACIÓN DE ESTADO INICIAL */}
          {activeModal === 'confirmReset' && (
            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-2">¿Restaurar al Estado Inicial (5 Nov 2026)?</h3>
              <p className="text-xs text-[#9292A3] mb-5">
                Esto restablecerá los ingresos recibidos a RD$13,500, las reservas a RD$10,590, el saldo disponible a RD$2,910 y los gastos realizados a RD$0.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setActiveModal(null)}
                  className="flex-1 py-2 rounded-xl bg-[#101014] text-[#9292A3] text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setState(createInitialState());
                    setActiveModal(null);
                    showToast('Sistema restaurado al estado inicial del 5 de noviembre de 2026', 'success');
                  }}
                  className="flex-1 py-2 rounded-xl bg-[#F87171] text-[#101014] text-xs font-bold"
                >
                  Sí, Restaurar Todo
                </button>
              </div>
            </div>
          )}

          {/* MODAL: LABORATORIO DE LAS 6 PRUEBAS OBLIGATORIAS */}
          {activeModal === 'pruebas' && (
            <div className="max-h-[80vh] overflow-y-auto pr-1">
              <div className="flex items-center gap-2 text-[#A78BFA] text-xs font-bold uppercase mb-1">
                <FlaskConical className="w-4 h-4" /> Verificador Interactivo de Calidad
              </div>
              <h3 className="text-lg font-bold text-[#F8FAFC] mb-2">
                6 Escenarios de Prueba Obligatorios
              </h3>
              <p className="text-xs text-[#9292A3] mb-4">
                Ejecuta cada prueba con un clic para comprobar que las fórmulas contables cumplen exactamente los resultados esperados sin descontar dos veces.
              </p>

              {/* Resumen en vivo para auditar */}
              <div className="grid grid-cols-3 gap-2 bg-[#101014] p-3 rounded-xl border border-[#A78BFA]/30 mb-4 text-xs">
                <div>
                  <span className="text-[10px] text-[#9292A3] block">Recibido / Real Caja</span>
                  <strong className="text-[#F8FAFC]">{formatDOP(metrics.totalReceivedIncome)} / {formatDOP(metrics.realCashBalance)}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-[#9292A3] block">Reservado / Libre</span>
                  <strong className="text-[#6EE7B7]">{formatDOP(metrics.totalReservedInEnvelopes)} / {formatDOP(metrics.unallocatedAvailable)}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-[#9292A3] block">Gastado Total</span>
                  <strong className="text-[#F87171]">{formatDOP(metrics.totalSpent)}</strong>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                {/* Prueba 1 */}
                <div className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#F8FAFC] block">Prueba 1: Estado Inicial (5 Nov)</strong>
                    <span className="text-[11px] text-[#9292A3]">
                      Recibido: RD$13,500 | Reservado: RD$10,590 | Libre: RD$2,910 | Gastado: RD$0
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setState(createInitialState());
                      showToast('Prueba 1 aplicada: Reservado RD$10,590 | Disponible RD$2,910 | Gastos RD$0', 'success');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#A78BFA] text-[#101014] font-bold shrink-0"
                  >
                    Restaurar P1
                  </button>
                </div>

                {/* Prueba 2 */}
                <div className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#F8FAFC] block">Prueba 2: Compra de alimentos (RD$450)</strong>
                    <span className="text-[11px] text-[#9292A3]">
                      Comida gastada: RD$450 | Saldo alimentación: RD$5,050 | Caja disminuye RD$450 sin descontar doble.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      handleAddExpense({
                        description: 'Prueba 2: Compra de alimentos',
                        amount: 450,
                        date: '2026-11-05',
                        categoryId: 'cat-food',
                        paymentMethod: 'Efectivo',
                        merchant: 'Supermercado',
                        foodType: 'Compra general',
                        useReserve: true,
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] text-[#101014] font-bold shrink-0"
                  >
                    Ejecutar P2
                  </button>
                </div>

                {/* Prueba 3 */}
                <div className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#F8FAFC] block">Prueba 3: Pago Factura Electricidad (RD$1,500)</strong>
                    <span className="text-[11px] text-[#9292A3]">
                      Usa reserva existente (queda en RD$0). Gasto +RD$1,500. El saldo libre NO disminuye una segunda vez.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const elecBill = state.bills.find((b) => b.id === 'bill-elec');
                      if (elecBill && elecBill.status !== 'pagado') {
                        handleAddExpense({
                          description: 'Prueba 3: Pago de Electricidad',
                          amount: 1500,
                          date: '2026-11-05',
                          categoryId: 'cat-elec',
                          paymentMethod: 'Transferencia',
                          useReserve: true,
                          billId: 'bill-elec',
                        });
                      } else {
                        showToast('La factura de electricidad ya figura como pagada', 'warning');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] text-[#101014] font-bold shrink-0"
                  >
                    Ejecutar P3
                  </button>
                </div>

                {/* Prueba 4 */}
                <div className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#F8FAFC] block">Prueba 4: Ingreso del próximo jueves (RD$3,500)</strong>
                    <span className="text-[11px] text-[#9292A3]">
                      Confirma el aporte de RD$3,500, aumenta el saldo real sin alterar el historial anterior.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const nextInc = state.incomes.find((i) => i.status === 'previsto');
                      if (nextInc) {
                        handleConfirmPlannedIncome(nextInc.id);
                      } else {
                        handleAddIncome('Aporte semanal jueves', 3500, '2026-11-12', 'recibido', 'semanal', undefined, false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] text-[#101014] font-bold shrink-0"
                  >
                    Ejecutar P4
                  </button>
                </div>

                {/* Prueba 5 */}
                <div className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#F8FAFC] block">Prueba 5: Combustible (RD$700)</strong>
                    <span className="text-[11px] text-[#9292A3]">
                      Registra RD$700 y calcula automáticamente 2.20 galones a RD$317.50/gal.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const gallons = roundDOP(700 / state.settings.fuelPrice);
                      handleAddExpense({
                        description: `Prueba 5: Gasolina (${gallons} gal a RD$317.50)`,
                        amount: 700,
                        date: '2026-11-05',
                        categoryId: 'cat-fuel',
                        paymentMethod: 'Efectivo',
                        useReserve: true,
                        fuelData: { gallons, pricePerGallon: state.settings.fuelPrice },
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] text-[#101014] font-bold shrink-0"
                  >
                    Ejecutar P5
                  </button>
                </div>

                {/* Prueba 6 */}
                <div className="bg-[#101014] p-3 rounded-xl border border-[#9292A3]/20 flex items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#F8FAFC] block">Prueba 6: Tres gastos foráneos (RD$50, RD$75, RD$100)</strong>
                    <span className="text-[11px] text-[#9292A3]">
                      Suma RD$225 en gastos cotidianos y registra los 3 movimientos individuales.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      handleAddExpense({
                        description: 'Gasto foráneo 1 (Mandado)',
                        amount: 50,
                        date: '2026-11-05',
                        categoryId: 'cat-foreign',
                        paymentMethod: 'Efectivo',
                        useReserve: false,
                      });
                      handleAddExpense({
                        description: 'Gasto foráneo 2 (Merienda calle)',
                        amount: 75,
                        date: '2026-11-05',
                        categoryId: 'cat-foreign',
                        paymentMethod: 'Efectivo',
                        useReserve: false,
                      });
                      handleAddExpense({
                        description: 'Gasto foráneo 3 (Imprevisto menor)',
                        amount: 100,
                        date: '2026-11-05',
                        categoryId: 'cat-foreign',
                        paymentMethod: 'Efectivo',
                        useReserve: false,
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] text-[#101014] font-bold shrink-0"
                  >
                    Ejecutar P6
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MODAL: MODIFICAR INGRESOS (NIVEL 1: BASE FUTURA Y NIVEL 2: RECIBIDOS/REGISTRADOS) */}
          {activeModal === 'modificarIngresos' && (
            <div className="max-h-[82vh] overflow-y-auto pr-1 space-y-5">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#A78BFA] flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5" /> Ajuste Dinámico sin Perder Estructura
                </span>
                <h3 className="text-lg font-bold text-[#F8FAFC] mt-0.5">
                  Modificar Ingresos del Hogar
                </h3>
                <p className="text-xs text-[#9292A3]">
                  Cambia los montos de tus ingresos ya recibidos o de tus aportes programados. Tus categorías, reservas actuales y gastos registrados se mantienen intactos. Si el ingreso recibido sube, el sistema te sugerirá cómo repartir el dinero extra entre los sobres pendientes.
                </p>
              </div>

              {/* NIVEL 2: Editar ingresos individuales ya recibidos o programados */}
              <div className="bg-[#101014] border border-[#6EE7B7]/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#6EE7B7] uppercase">
                    A. Editar Ingresos Recibidos o Programados
                  </span>
                  <span className="text-[11px] text-[#9292A3]">
                    Actualiza el valor y presiona "Aplicar"
                  </span>
                </div>

                <div className="space-y-2.5">
                  {state.incomes.map((inc) => (
                    <form
                      key={inc.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        const newAmt = Number(fd.get('amount'));
                        const newDate = String(fd.get('date') || inc.expectedDate);
                        const newSrc = String(fd.get('source') || inc.source);
                        handleEditSingleIncome(inc.id, newAmt, newDate, newSrc);
                      }}
                      className="bg-[#191922] p-3 rounded-xl border border-[#9292A3]/20 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex-1 min-w-[170px]">
                        <input
                          name="source"
                          defaultValue={inc.source}
                          className="bg-transparent font-bold text-[#F8FAFC] w-full focus:outline-none border-b border-transparent focus:border-[#A78BFA]"
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                              inc.status === 'recibido'
                                ? 'bg-[#6EE7B7]/15 text-[#6EE7B7]'
                                : 'bg-[#FBBF24]/15 text-[#FBBF24]'
                            }`}
                          >
                            {inc.status}
                          </span>
                          <input
                            type="date"
                            name="date"
                            defaultValue={inc.expectedDate}
                            className="bg-[#101014] text-[#9292A3] text-[11px] px-2 py-0.5 rounded border border-[#9292A3]/20"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center bg-[#101014] border border-[#9292A3]/30 rounded-lg px-2.5 py-1.5">
                          <span className="text-[#9292A3] mr-1">RD$</span>
                          <input
                            type="number"
                            name="amount"
                            step="0.01"
                            min="1"
                            defaultValue={inc.amount}
                            className="bg-transparent text-[#F8FAFC] font-extrabold w-24 focus:outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          className="px-3 py-1.5 rounded-lg bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] font-bold transition"
                        >
                          Aplicar
                        </button>
                      </div>
                    </form>
                  ))}
                </div>
              </div>

              {/* NIVEL 1: Modificar Ingresos Base de Referencia Hacia Adelante */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const newMonthly = Number(fd.get('monthlyIncome'));
                  const newWeekly = Number(fd.get('weeklyIncome'));
                  const syncThursdays = fd.get('syncThursdays') === 'on';
                  handleUpdateBaseIncomes(newMonthly, newWeekly, syncThursdays);
                  setActiveModal(null);
                }}
                className="bg-[#101014] border border-[#A78BFA]/30 rounded-2xl p-4 space-y-3 text-xs"
              >
                <span className="text-xs font-bold text-[#C4B5FD] uppercase block">
                  B. Modificar Sueldo / Aporte Base Fijo (Hacia Adelante)
                </span>
                <p className="text-[11px] text-[#9292A3]">
                  Actualiza la referencia mensual teórica (actualmente {formatDOP(metrics.referenceMonthlyIncome)}) y opcionalmente todos los jueves que aún están pendientes por recibir.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#9292A3] mb-1">Ingreso Fijo Mensual (RD$)</label>
                    <input
                      type="number"
                      name="monthlyIncome"
                      step="100"
                      defaultValue={state.settings.monthlyIncome}
                      required
                      className="w-full bg-[#191922] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[#9292A3] mb-1">Aporte de cada Jueves (RD$)</label>
                    <input
                      type="number"
                      name="weeklyIncome"
                      step="100"
                      defaultValue={state.settings.weeklyIncome}
                      required
                      className="w-full bg-[#191922] border border-[#9292A3]/30 rounded-xl px-3 py-2 text-[#F8FAFC] font-bold"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-[#F8FAFC] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    name="syncThursdays"
                    defaultChecked
                    className="rounded accent-[#A78BFA]"
                  />
                  <span>Actualizar automáticamente los próximos jueves previstos con este nuevo monto semanal</span>
                </label>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#A78BFA] hover:bg-[#C4B5FD] text-[#101014] font-bold transition"
                >
                  Guardar Nuevos Parámetros Base
                </button>
              </form>
            </div>
          )}

          {/* MODAL: ASISTENTE INTELIGENTE DE REPARTO DE INGRESO EXTRA */}
          {activeModal === 'repartirExcedente' && surplusContext && (
            <div className="max-h-[84vh] overflow-y-auto pr-1 space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#6EE7B7]/15 text-[#6EE7B7]">
                  <Sparkles className="w-3.5 h-3.5" /> Asistente Inteligente de Distribución
                </span>
              </div>

              <div>
                <h3 className="text-lg font-extrabold text-[#F8FAFC]">
                  ¡Tienes {formatDOP(surplusContext.extraAmount)} disponibles para organizar!
                </h3>
                <p className="text-xs text-[#9292A3] mt-0.5">
                  Origen: <strong className="text-[#C4B5FD]">{surplusContext.sourceTitle}</strong>. El sistema ha detectado qué sobres aún tienen presupuesto pendiente por asignar este mes (como los RD$4,500 faltantes de Alimentación) y te sugiere este reparto editable:
                </p>
              </div>

              {/* Botones rápidos de pre-configuración en 1 clic */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSurplusContext((prev) =>
                      prev ? { ...prev, allocations: buildSmartProposal(prev.extraAmount) } : prev
                    )
                  }
                  className="px-3 py-1.5 rounded-xl bg-[#A78BFA]/20 hover:bg-[#A78BFA]/30 text-[#C4B5FD] border border-[#A78BFA]/40 text-xs font-semibold transition"
                >
                  ✨ Reparto Inteligente Sugerido
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const onlyFood: Record<string, number> = {};
                    state.categories.forEach((c) => {
                      onlyFood[c.id] = c.id === 'cat-food' ? surplusContext.extraAmount : 0;
                    });
                    setSurplusContext((prev) => (prev ? { ...prev, allocations: onlyFood } : prev));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#6EE7B7]/15 hover:bg-[#6EE7B7]/25 text-[#A7F3D0] border border-[#6EE7B7]/30 text-xs font-semibold transition"
                >
                  🍽️ Todo a Alimentación
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const zeroMap: Record<string, number> = {};
                    state.categories.forEach((c) => {
                      zeroMap[c.id] = 0;
                    });
                    setSurplusContext((prev) => (prev ? { ...prev, allocations: zeroMap } : prev));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#101014] hover:bg-[#9292A3]/20 text-[#9292A3] border border-[#9292A3]/25 text-xs font-semibold transition"
                >
                  Limpiar (Dejar 100% en Saldo Libre)
                </button>
              </div>

              {/* Lista de sobres con saldo pendiente de asignar */}
              {(() => {
                const totalAssignedInModal = roundDOP(
                  Object.values(surplusContext.allocations).reduce((acc, v) => acc + (Number(v) || 0), 0)
                );
                const remainingUnassigned = roundDOP(surplusContext.extraAmount - totalAssignedInModal);

                return (
                  <>
                    <div className="bg-[#101014] p-3.5 rounded-xl border border-[#9292A3]/20 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-[10px] text-[#9292A3] block">Monto a Distribuir</span>
                        <strong className="text-[#F8FAFC] text-sm">{formatDOP(surplusContext.extraAmount)}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#9292A3] block">A Guardar en Sobres</span>
                        <strong className="text-[#C4B5FD] text-sm">{formatDOP(totalAssignedInModal)}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#9292A3] block">Queda en Saldo Libre</span>
                        <strong
                          className={`text-sm ${
                            remainingUnassigned < 0 ? 'text-[#F87171]' : 'text-[#6EE7B7]'
                          }`}
                        >
                          {formatDOP(remainingUnassigned)}
                        </strong>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                      {state.categories
                        .filter((c) => c.id !== 'cat-foreign')
                        .map((cat) => {
                          const env = state.envelopes.find((e) => e.categoryId === cat.id);
                          const allocated = env?.allocatedAmount || 0;
                          const pending = Math.max(0, roundDOP(cat.monthlyLimit - allocated));
                          const currentVal = surplusContext.allocations[cat.id] || 0;

                          return (
                            <div
                              key={cat.id}
                              className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                                currentVal > 0
                                  ? 'bg-[#101014] border-[#A78BFA]/50'
                                  : 'bg-[#101014]/60 border-[#9292A3]/15'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-[#F8FAFC] flex items-center gap-2">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: cat.color }}
                                  />
                                  <span>{cat.name}</span>
                                </div>
                                <div className="text-[11px] text-[#9292A3] mt-0.5">
                                  Meta: {formatDOP(cat.monthlyLimit)} • Ya asignado: {formatDOP(allocated)} •{' '}
                                  <strong className={pending > 0 ? 'text-[#FBBF24]' : 'text-[#6EE7B7]'}>
                                    {pending > 0 ? `Faltan ${formatDOP(pending)}` : 'Meta cubierta'}
                                  </strong>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 bg-[#191922] border border-[#9292A3]/30 rounded-lg px-2.5 py-1.5 shrink-0">
                                <span className="text-[#9292A3] text-[11px]">+RD$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="50"
                                  value={currentVal}
                                  onChange={(e) => {
                                    const val = Math.max(0, roundDOP(Number(e.target.value) || 0));
                                    setSurplusContext((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            allocations: { ...prev.allocations, [cat.id]: val },
                                          }
                                        : prev
                                    );
                                  }}
                                  className="bg-transparent text-[#6EE7B7] font-extrabold w-20 text-right focus:outline-none"
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveModal(null);
                          setSurplusContext(null);
                          showToast('El ingreso extra se mantuvo íntegro en tu Dinero Disponible sin asignar', 'success');
                        }}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-[#101014] hover:bg-[#9292A3]/20 text-[#9292A3] hover:text-[#F8FAFC] border border-[#9292A3]/25 text-xs font-semibold transition"
                      >
                        Dejar Todo en Disponible
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplySurplusDistribution(surplusContext.allocations)}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#101014] text-xs font-extrabold transition shadow-md"
                      >
                        Confirmar Reparto ({formatDOP(totalAssignedInModal)})
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ==========================================
  // 11. LAYOUT GENERAL (SIDEBAR + HEADER + MAIN)
  // ==========================================

  return (
    <div className="min-h-screen bg-[#101014] text-[#F8FAFC] flex flex-col lg:flex-row font-sans selection:bg-[#A78BFA] selection:text-[#101014]">
      {/* Notificación flotante */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl border text-xs font-semibold flex items-center gap-2 transition-all ${
            toast.type === 'error'
              ? 'bg-[#191922] border-[#F87171] text-[#F87171]'
              : toast.type === 'warning'
              ? 'bg-[#191922] border-[#FBBF24] text-[#FBBF24]'
              : 'bg-[#191922] border-[#6EE7B7] text-[#6EE7B7]'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Sidebar Escritorio */}
      <aside className="hidden lg:flex lg:w-64 xl:w-72 bg-[#191922] border-r border-[#9292A3]/15 flex-col justify-between shrink-0">
        <div className="p-5">
          {/* Logo e Identidad */}
          <div className="flex items-center gap-3 pb-5 mb-5 border-b border-[#9292A3]/15">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#A78BFA] to-[#6EE7B7] flex items-center justify-center text-[#101014] font-extrabold text-lg shadow-md">
              MB
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight text-[#F8FAFC] leading-none">
                MI BALANCE
              </h1>
              <p className="text-[11px] text-[#C4B5FD] mt-1 font-medium">
                "Cada peso tiene un propósito"
              </p>
            </div>
          </div>

          {/* Menú de 11 Secciones */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition ${
                    isActive
                      ? 'bg-[#A78BFA] text-[#101014] font-bold shadow-md shadow-[#A78BFA]/20'
                      : 'text-[#9292A3] hover:bg-[#101014] hover:text-[#F8FAFC]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Resumen rápido en el pie del sidebar */}
        <div className="p-4 m-4 rounded-2xl bg-[#101014] border border-[#9292A3]/15 text-xs space-y-2">
          <div className="flex justify-between text-[#9292A3]">
            <span>Saldo Libre:</span>
            <strong className="text-[#6EE7B7]">{formatDOP(metrics.unallocatedAvailable)}</strong>
          </div>
          <div className="flex justify-between text-[#9292A3]">
            <span>En Sobres:</span>
            <strong className="text-[#C4B5FD]">{formatDOP(metrics.totalReservedInEnvelopes)}</strong>
          </div>
          <div className="flex justify-between text-[#9292A3] pt-1 border-t border-[#9292A3]/15">
            <span>Caja Real:</span>
            <strong className="text-[#F8FAFC]">{formatDOP(metrics.realCashBalance)}</strong>
          </div>
        </div>
      </aside>

      {/* Cabecera Móvil / Tablet */}
      <header className="lg:hidden bg-[#191922] border-b border-[#9292A3]/15 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#A78BFA] to-[#6EE7B7] flex items-center justify-center text-[#101014] font-extrabold text-sm">
            MB
          </div>
          <div>
            <span className="font-extrabold text-sm text-[#F8FAFC] block leading-none">MI BALANCE</span>
            <span className="text-[10px] text-[#6EE7B7]">Libre: {formatDOP(metrics.unallocatedAvailable)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveModal('gasto')}
            className="px-2.5 py-1.5 rounded-lg bg-[#A78BFA] text-[#101014] text-xs font-bold"
          >
            + Gasto
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg bg-[#101014] text-[#F8FAFC]"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Drawer Móvil */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/80 flex">
          <div className="w-72 bg-[#191922] h-full p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <span className="font-bold text-[#A78BFA]">Menú de Navegación</span>
              <button onClick={() => setMobileMenuOpen(false)}>
                <X className="w-5 h-5 text-[#9292A3]" />
              </button>
            </div>
            <div className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium ${
                      activeTab === item.id
                        ? 'bg-[#A78BFA] text-[#101014] font-bold'
                        : 'text-[#9292A3]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Contenido Principal */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        {/* Top Bar informativa */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[#9292A3]/15">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#F8FAFC]">
                {navItems.find((n) => n.id === activeTab)?.label}
              </h1>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#A78BFA]/15 text-[#C4B5FD] font-medium">
                DOP (RD$)
              </span>
            </div>
            <p className="text-xs text-[#9292A3] mt-0.5">
              Fecha del sistema: <strong className="text-[#F8FAFC]">{state.settings.currentSystemDate}</strong> • Próximo aporte semanal: <strong className="text-[#6EE7B7]">Jueves {metrics.nextThursday} (RD$3,500)</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveModal('modificarIngresos')}
              className="bg-[#A78BFA]/15 hover:bg-[#A78BFA]/25 border border-[#A78BFA]/40 rounded-xl px-3.5 py-2 text-xs text-[#C4B5FD] font-bold flex items-center gap-1.5 transition"
            >
              <Edit3 className="w-3.5 h-3.5" /> Modificar Ingresos
            </button>
            <div className="bg-[#191922] border border-[#9292A3]/20 rounded-xl px-3.5 py-2 text-xs">
              <span className="text-[#9292A3] mr-1.5">Alimentación Disp.:</span>
              <strong className="text-[#C4B5FD]">{formatDOP(metrics.foodEnvelope.reservedAmount)}</strong>
            </div>
            <div className="bg-[#191922] border border-[#6EE7B7]/30 rounded-xl px-3.5 py-2 text-xs">
              <span className="text-[#9292A3] mr-1.5">Para llegar al jueves:</span>
              <strong className="text-[#6EE7B7]">{formatDOP(metrics.unallocatedAvailable)}</strong>
            </div>
          </div>
        </div>

        {/* Renderizado dinámico de las 11 vistas */}
        {activeTab === 'resumen' && renderResumenGeneral()}
        {activeTab === 'midinero' && renderMiDinero()}
        {activeTab === 'presupuesto' && renderPresupuestoMensual()}
        {activeTab === 'semanal' && renderControlSemanal()}
        {activeTab === 'alimentacion' && renderAlimentacion()}
        {activeTab === 'combustible' && renderCombustible()}
        {activeTab === 'facturas' && renderFacturasYPagos()}
        {activeTab === 'cotidianos' && renderGastosCotidianos()}
        {activeTab === 'historial' && renderHistorial()}
        {activeTab === 'informes' && renderInformes()}
        {activeTab === 'configuracion' && renderConfiguracion()}
      </main>

      {/* Modales */}
      {renderModals()}
    </div>
  );
}