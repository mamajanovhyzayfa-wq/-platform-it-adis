import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ShopOrder } from '@/api/api'
import { describeApiError } from '@/api/client'
import { Badge, Button, Card, EmptyState, Loader, Screen, Title } from '@/components/ui'
import { useI18n, type MessageKey } from '@/i18n'
import { spacing, typography, useTheme, useThemedStyles, type Palette } from '@/theme'

const orderStatusKeys: Record<ShopOrder['status'], MessageKey> = {
  NEW: 'shop.status.NEW',
  APPROVED: 'shop.status.APPROVED',
  READY: 'shop.status.READY',
  ISSUED: 'shop.status.ISSUED',
  REJECTED: 'shop.status.REJECTED',
  CANCELLED: 'shop.status.CANCELLED',
}

const orderTones: Record<ShopOrder['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'primary'> = {
  NEW: 'primary',
  APPROVED: 'warning',
  READY: 'warning',
  ISSUED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
}

const categoryKeys: Record<string, MessageKey> = {
  DIGITAL: 'shop.category.digital',
  DISCOUNT: 'shop.category.discount',
  MATERIAL: 'shop.category.material',
  PRIVILEGE: 'shop.category.privilege',
  PHYSICAL: 'shop.category.physical',
}

const categories = ['', 'DIGITAL', 'DISCOUNT', 'MATERIAL', 'PRIVILEGE', 'PHYSICAL'] as const

/** Магазин наград: баланс, каталог и история заявок. Списание выполняет сервер. */
export default function ShopScreen() {
  const { t } = useI18n()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)

  const products = useQuery({
    queryKey: ['shop-products', search, category, favoriteOnly],
    queryFn: () => api.shopProducts({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(category ? { category } : {}),
      ...(favoriteOnly ? { favorite: true } : {}),
    }),
  })
  const orders = useQuery({ queryKey: ['shop-orders'], queryFn: api.shopOrders })
  const balance = useQuery({ queryKey: ['coin-balance'], queryFn: api.coinBalance })

  const favorite = useMutation({
    mutationFn: (id: string) => api.toggleShopFavorite(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shop-products'] }),
    onError: (error) => Alert.alert(t('common.error'), describeApiError(error)),
  })

  const buy = useMutation({
    mutationFn: (productId: string) => api.buyProduct({ productId }),
    onSuccess: (order) => {
      setNotice(order.status === 'ISSUED' ? t('shop.issued') : t('shop.orderSent'))
      void queryClient.invalidateQueries({ queryKey: ['shop-products'] })
      void queryClient.invalidateQueries({ queryKey: ['shop-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['coin-balance'] })
      void queryClient.invalidateQueries({ queryKey: ['coin-history'] })
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
    onError: (error) => Alert.alert(t('shop.orderFailed'), describeApiError(error)),
  })

  const confirmBuy = (productId: string, title: string, price: number) => {
    Alert.alert(t('shop.confirmTitle'), `«${title}» — ${price} ${t('shop.coins')}. ${t('shop.confirmText')}`, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('shop.order'), onPress: () => buy.mutate(productId) },
    ])
  }

  const currentBalance = balance.data ?? 0

  return (
    <Screen>
      <Title>{t('shop.title')}</Title>

      <Card style={styles.balanceCard}>
        <View>
          <Text style={styles.muted}>{t('shop.balance')}</Text>
          <Text style={styles.balance}>{currentBalance}</Text>
        </View>
        <Text style={styles.muted}>{t('shop.balanceHint')}</Text>
      </Card>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t('shop.search')}
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.card }]}
      />
      <View style={styles.filters}>
        {categories.map((value) => (
          <Pressable
            key={value || 'ALL'}
            onPress={() => setCategory(value)}
            style={[styles.chip, category === value && { backgroundColor: theme.colors.primarySoft }]}
          >
            <Text style={[styles.chipText, category === value && { color: theme.colors.primary }]}>
              {value ? t(categoryKeys[value]) : t('common.all')}
            </Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setFavoriteOnly((value) => !value)} style={[styles.chip, favoriteOnly && { backgroundColor: theme.colors.primarySoft }]}>
          <Text style={[styles.chipText, favoriteOnly && { color: theme.colors.primary }]}>★ {t('shop.favorites')}</Text>
        </Pressable>
      </View>

      {products.isLoading ? <Loader /> : null}
      {products.error ? <Text style={styles.error}>{describeApiError(products.error)}</Text> : null}

      {products.data && products.data.length === 0 ? (
        <EmptyState title={t('shop.empty')} hint={t('shop.emptyHint')} />
      ) : null}

      {products.data?.map((product) => {
        const affordable = currentBalance >= product.priceCoins
        const available = product.available
        const categoryKey = categoryKeys[product.category]
        return (
          <Card key={product.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{product.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={product.favorite ? t('shop.removeFavorite') : t('shop.addFavorite')} onPress={() => favorite.mutate(product.id)}>
                <Text style={styles.favorite}>{product.favorite ? '★' : '☆'}</Text>
              </Pressable>
            </View>
            <Badge label={categoryKey ? t(categoryKey) : product.category} tone="neutral" />
            <Text style={styles.muted}>{product.description}</Text>
            {product.terms ? (
              <Text style={styles.muted}>
                {t('shop.terms')}: {product.terms}
              </Text>
            ) : null}
            <View style={styles.rowBetween}>
              <Text style={styles.price}>
                {product.priceCoins} {t('shop.coins')}
              </Text>
              <Text style={styles.muted}>
                {product.unlimitedStock ? t('shop.unlimited') : `${t('shop.stock')}: ${product.stock ?? 0}`}
              </Text>
            </View>
            {!available ? <Text style={styles.muted}>{t('shop.outOfStock')}</Text> : null}
            {available && !affordable ? (
              <Text style={styles.muted}>
                {t('shop.notEnough')} {product.priceCoins - currentBalance} {t('shop.coins')}
              </Text>
            ) : null}
            <Button
              title={buy.isPending ? t('shop.ordering') : t('shop.order')}
              disabled={!available || !affordable || buy.isPending}
              onPress={() => confirmBuy(product.id, product.title, product.priceCoins)}
              style={styles.buyButton}
            />
          </Card>
        )
      })}

      <Text style={styles.sectionTitle}>{t('shop.myOrders')}</Text>
      {orders.isLoading ? <Loader /> : null}
      {orders.data && orders.data.length === 0 ? (
        <EmptyState title={t('shop.ordersEmpty')} hint={t('shop.ordersEmptyHint')} />
      ) : null}
      {orders.data?.map((order) => (
        <Card key={order.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{order.product.title}</Text>
            <Badge label={t(orderStatusKeys[order.status])} tone={orderTones[order.status]} />
          </View>
          <Text style={styles.muted}>{new Date(order.createdAt).toLocaleString()}</Text>
          <Text style={styles.muted}>
            {t('shop.spent')}: {order.priceCoins ?? order.product.priceCoins} {t('shop.coins')}
          </Text>
          {order.deliveryDetails ? <Text style={styles.muted}>{t('shop.delivery')}: {order.deliveryDetails}</Text> : null}
          {order.status === 'REJECTED' || order.status === 'CANCELLED' ? <Text style={styles.muted}>{t('shop.refunded')}</Text> : null}
        </Card>
      ))}
    </Screen>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    balanceCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    balance: { fontSize: 28, fontWeight: '800', color: c.primary },
    cardTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, flex: 1 },
    muted: { fontSize: typography.caption, color: c.textMuted },
    price: { fontSize: typography.body, fontWeight: '700', color: c.primary },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    sectionTitle: { fontSize: typography.h2, fontWeight: '700', color: c.text, marginTop: spacing.md },
    notice: { color: c.success, fontSize: typography.caption },
    error: { color: c.danger, fontSize: typography.caption },
    buyButton: { marginTop: spacing.sm },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: typography.body },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: c.cardMuted },
    chipText: { fontSize: typography.tiny, color: c.textMuted, fontWeight: '600' },
    favorite: { fontSize: 24, color: c.warning },
  })
