/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: LicenseRef-Realtek-5-Clause
 */

/**
 * @file lv_draw_rtk_ppe_utils.h
 *
 */

#ifndef LV_PPE_UTILS_H
#define LV_PPE_UTILS_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../../lv_conf_internal.h"

#if LV_USE_DRAW_PPE_RTL8773G
#include "../../sw/lv_draw_sw.h"
#include "../../../misc/lv_log.h"
#include "rtl_ppe.h"
#include "rtl876x_rcc.h"

/*********************
 *      DEFINES
 *********************/
#define LV_PPE_MAX_BUFFER_SIZE  (0 * 1024)

#define LV_PPE_CACHE_NONE               0
#define LV_PPE_CACHE_WRITE_BACK         1
#define LV_PPE_CACHE_WRITE_THROUGH      2

#define LV_PPE_CACHE_STRATEGY           LV_PPE_CACHE_NONE

#define LV_PPE_DRAW_ASYNC               0

/**********************
 *      TYPEDEFS
 **********************/

/**********************
 * GLOBAL PROTOTYPES
 **********************/
uint32_t lv_ppe_get_color(lv_color_t color, uint8_t opa);

PPE_ERR lv_ppe_recolor(ppe_buffer_t *image, ppe_buffer_t *buffer, ppe_rect_t *rect, uint32_t color);

uint8_t *lv_ppe_get_buffer(uint32_t size);

PPE_PIXEL_FORMAT lv_ppe_get_format(lv_color_format_t cf);

lv_area_t lv_ppe_get_matrix_area(ppe_matrix_t *matrix, const lv_area_t *coords,
                                 const lv_draw_image_dsc_t *draw_dsc);

void lv_ppe_get_matrix(ppe_matrix_t *matrix, const lv_area_t *coords,
                       const lv_draw_image_dsc_t *draw_dsc);

void lv_ppe_get_inverse_matrix(ppe_matrix_t *matrix, const lv_area_t *coords,
                               const lv_draw_image_dsc_t *draw_dsc);

bool lv_ppe_get_area(ppe_rect_t *result_rect, ppe_rect_t *source_rect, ppe_matrix_t *matrix);

uint8_t lv_acc_get_high_speed_channel(void);

uint8_t lv_acc_get_low_speed_channel(void);

void lv_acc_dma_channel_init(void);

void lv_acc_dma_copy(uint32_t length, uint32_t height, uint32_t src_stride,
                     uint32_t dst_stride, uint8_t *src, uint8_t *dst);

void subtract_intersection(const lv_area_t *area, const lv_area_t *intersection,
                           lv_area_t *result, int *result_area_count);

bool lv_ppe_use_entire(lv_draw_task_t *t, lv_display_t *disp);

void lv_ppe_finish(void);

#if LV_PPE_DRAW_ASYNC
void lv_ppe_register_decoded_dsc(lv_image_decoder_dsc_t *dsc);
#endif

#if LV_PPE_CACHE_STRATEGY != LV_PPE_CACHE_NONE
void lv_set_previous_hw(bool is_hw);
void lv_set_previous_cpu(bool is_cpu);
bool lv_is_previous_hw(void);
bool lv_is_previous_cpu(void);
void lv_ppe_clean_cache(void *addr, uint32_t size);
void lv_mve_arm2d_iir_blur(lv_draw_buf_t *buf, uint8_t blur_degree, bool dual_dir);
#endif
/**********************
 *      MACROS
 **********************/


#endif /*LV_USE_PPE*/

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_PPE_UTILS_H*/
