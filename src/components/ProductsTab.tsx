import React, { useState } from 'react';
import { Search, ExternalLink, Sparkles, Filter, CheckCircle, ArrowUpDown, History } from 'lucide-react';
import { Product } from '../types';

interface ProductsTabProps {
  products: Product[];
  onGenerateCopy: (product: Product) => void;
  isLoading: boolean;
  onRefresh: () => void;
}

export const ProductsTab: React.FC<ProductsTabProps> = ({
  products,
  onGenerateCopy,
  isLoading,
  onRefresh
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProductForHistory, setSelectedProductForHistory] = useState<Product | null>(null);

  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[];

  const filtered = products.filter(p => {
    const matchesSearch = p.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCat = selectedCategory === 'all' || p.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const formatBRL = (val?: number) => {
    if (val === undefined || val === null) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <div className="space-y-5">
      {/* Header and Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative flex-1 w-full sm:w-auto max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome, marca ou SKU..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <div className="flex items-center space-x-1 text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5" />
            <span>Categoria:</span>
          </div>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
          >
            <option value="all">Todas ({products.length})</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-4">Produto & SKU</th>
                <th className="py-3.5 px-4">Preço Atual</th>
                <th className="py-3.5 px-4">Preço Anterior</th>
                <th className="py-3.5 px-4">Marca & Categoria</th>
                <th className="py-3.5 px-4">Link Afiliado (/20889)</th>
                <th className="py-3.5 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    Nenhum produto encontrado. Execute o crawler para raspar ofertas reais da Loja do Mecânico.
                  </td>
                </tr>
              ) : (
                filtered.map(product => (
                  <tr key={product.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 max-w-xs">
                      <div className="flex items-start space-x-3">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt=""
                            className="w-12 h-12 rounded object-cover border border-slate-200 bg-white shrink-0"
                            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-xs shrink-0">
                            Sem foto
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 line-clamp-2" title={product.product_name}>
                            {product.product_name}
                          </p>
                          <div className="flex items-center space-x-2 mt-1">
                            {product.sku && (
                              <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                SKU: {product.sku}
                              </span>
                            )}
                            <span className="text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                              Válido
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                      {formatBRL(product.current_price)}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      {product.previous_price && product.previous_price > product.current_price ? (
                        <span className="text-slate-400 line-through text-xs">
                          {formatBRL(product.previous_price)}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <p className="font-medium text-slate-800 text-xs">{product.brand || 'Loja do Mecânico'}</p>
                      <p className="text-slate-500 text-xs">{product.category || 'Ferramentas'}</p>
                    </td>

                    <td className="py-3 px-4 max-w-xs">
                      <div className="flex items-center space-x-1.5">
                        <a
                          href={product.affiliate_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-orange-600 hover:text-orange-700 truncate max-w-[200px] hover:underline"
                          title={product.affiliate_url}
                        >
                          {product.affiliate_url}
                        </a>
                        <ExternalLink className="w-3 h-3 text-orange-500 shrink-0" />
                      </div>
                      <span className="text-[10px] text-emerald-600 font-semibold">
                        {product.affiliate_url.endsWith('/20889') ? '✓ Sufixo /20889 confirmado' : 'Aviso: sufixo pendente'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => onGenerateCopy(product)}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-orange-600" />
                        <span>Gerar Copy / Post</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
